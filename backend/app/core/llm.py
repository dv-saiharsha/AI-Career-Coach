import contextlib
import contextvars
import json
import logging
import re
import time
from typing import AsyncIterator, Protocol, runtime_checkable

import httpx
from anthropic import AsyncAnthropic, Anthropic

from app.core.config import settings

logger = logging.getLogger(__name__)

# Indirection so tests can skip real backoff sleeps.
_sleep = time.sleep


class LLMProviderError(RuntimeError):
    """A local/remote model call failed in a way the caller cannot fix.

    A RuntimeError on purpose: routes that already map RuntimeError (the old
    "no API key" case) to a 503 keep working, and main.py's global handler
    turns every other escape into an honest 503 instead of a bare 500.
    `kind` says what went wrong so the operator log (never the client
    response) can be specific.
    """

    def __init__(self, message: str, kind: str = "error") -> None:
        super().__init__(message)
        self.kind = kind  # unreachable | timeout | model_missing | bad_output | truncated | http | unsupported


_BACKGROUND: contextvars.ContextVar[bool] = contextvars.ContextVar("ollama_background", default=False)


@contextlib.contextmanager
def background():
    """Mark the calls made inside as background work: they get
    OLLAMA_TIMEOUT_BACKGROUND_SECONDS instead of the interactive limit. Used by
    the crawl worker and the scripts, never by an API request."""
    token = _BACKGROUND.set(True)
    try:
        yield
    finally:
        _BACKGROUND.reset(token)


def validate_against_schema(value, schema: dict, path: str = "$") -> str | None:
    """Return a one-line reason `value` doesn't match `schema`, or None.

    Covers only what this app's tool schemas use: type (including a list of
    types), enum, required, properties, items. Unknown keywords are ignored
    rather than rejected. Ollama constrains decoding with the schema, but a
    smaller model can still return something that is JSON and not the shape
    asked for, and every caller indexes into the result as if it were.
    """
    expected = schema.get("type")
    if expected is not None:
        allowed = expected if isinstance(expected, list) else [expected]
        checks = {
            "string": lambda v: isinstance(v, str),
            "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
            "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
            "boolean": lambda v: isinstance(v, bool),
            "array": lambda v: isinstance(v, list),
            "object": lambda v: isinstance(v, dict),
            "null": lambda v: v is None,
        }
        if not any(checks.get(t, lambda _v: True)(value) for t in allowed):
            return f"{path}: expected {'/'.join(allowed)}, got {type(value).__name__}"
    if "enum" in schema and value not in schema["enum"]:
        return f"{path}: {value!r} is not one of {schema['enum']}"
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                return f"{path}: missing required field '{key}'"
        for key, sub in (schema.get("properties") or {}).items():
            if key in value:
                problem = validate_against_schema(value[key], sub, f"{path}.{key}")
                if problem:
                    return problem
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for i, item in enumerate(value):
            problem = validate_against_schema(item, schema["items"], f"{path}[{i}]")
            if problem:
                return problem
    return None


@runtime_checkable
class LLMProvider(Protocol):
    """What the rest of the app may rely on from `llm_client`, whichever
    provider LLM_PROVIDER selects. The first four are the members every call
    site already used; embed/health/supports_batch are new.

    `available` is a configuration check, never a network call. `supports_batch`
    says whether the provider has a bulk asynchronous API (Anthropic's Message
    Batches); callers that would use it must check, and otherwise go one
    request at a time.
    """

    provider: str
    supports_batch: bool

    @property
    def available(self) -> bool: ...

    def complete_json(self, system: str, user: str, max_tokens: int = 1500) -> str: ...

    def complete_tool_json(
        self, system: str, user: str, tool_name: str, input_schema: dict, max_tokens: int = 1500,
        model: str | None = None,
    ) -> dict: ...

    def stream_message(self, system: str, messages: list[dict], max_tokens: int = 1500) -> AsyncIterator[str]: ...

    def embed(self, texts: list[str]) -> list[list[float]]: ...

    def health(self) -> dict: ...


class ClaudeClient:
    """Thin wrapper around the Anthropic Messages API, shared across modules."""

    provider = "anthropic"
    # The Message Batches API (job enrichment) exists only here.
    supports_batch = True

    def __init__(self) -> None:
        self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY) if settings.ANTHROPIC_API_KEY else None
        # Separate async client for streaming only. Every other method on this
        # class is synchronous and called from ordinary `def` route handlers;
        # introducing async there for one feature would ripple through every
        # call site. The Career Coach's streaming chat is the one caller that
        # actually needs a non-blocking, awaitable token stream.
        self._async_client = (
            AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY) if settings.ANTHROPIC_API_KEY else None
        )

    @property
    def available(self) -> bool:
        return self._client is not None

    def health(self) -> dict:
        """Config-only: no request is sent, so a health probe never bills."""
        return {
            "provider": self.provider,
            "status": "ok" if self.available else "unavailable",
            "model": settings.ANTHROPIC_MODEL,
            "anthropic_key_configured": self.available,
        }

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise LLMProviderError(
            "Anthropic offers no embeddings API; embeddings need LLM_PROVIDER=ollama", "unsupported"
        )

    def complete_json(self, system: str, user: str, max_tokens: int = 1500) -> str:
        """Ask Claude for a response and return the raw text (expected to contain JSON).

        Prefer complete_tool_json over this where possible — asking the model
        to emit raw JSON text and parsing it after the fact is fragile (an
        unescaped quote inside a free-text field breaks the whole response,
        which happened for ~48% of calls in practice). Kept for now for
        callers not yet migrated to a tool schema."""
        if not self._client:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured")
        response = self._client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(block.text for block in response.content if block.type == "text")

    def complete_tool_json(
        self, system: str, user: str, tool_name: str, input_schema: dict, max_tokens: int = 1500,
        model: str | None = None,
    ) -> dict:
        """Forces a schema-conformant JSON response via tool use instead of
        asking the model to emit raw JSON text — the API enforces the shape,
        so malformed/unescaped output isn't possible the way it is with
        complete_json + parse_json_response."""
        if not self._client:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured")
        response = self._client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            tools=[{"name": tool_name, "description": f"Return {tool_name}.", "input_schema": input_schema}],
            tool_choice={"type": "tool", "name": tool_name},
        )
        for block in response.content:
            if block.type == "tool_use":
                return block.input
        raise ValueError("Model did not return a tool_use block")

    async def stream_message(
        self, system: str, messages: list[dict], max_tokens: int = 1500
    ) -> AsyncIterator[str]:
        """Yield text deltas as Claude generates them, for the Career Coach's
        streaming chat. `messages` is the full conversation turn list
        (`[{"role": "user"|"assistant", "content": str}, ...]`) — unlike the
        single-shot methods above, a chat turn needs prior turns for context.
        """
        if not self._async_client:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured")
        async with self._async_client.messages.stream(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text


class OllamaClient:
    """The same surface as ClaudeClient (plus embeddings), served by a local Ollama.

    Structured output uses Ollama's `format` field (a JSON schema constrains
    decoding), the counterpart of Claude's forced tool call. Because an 8B
    model can still return JSON that is not the requested shape, every
    structured reply is validated against the schema and re-asked once or
    twice with the problem named before giving up.

    `_client` mirrors ClaudeClient's "configured backend handle or None", so
    code and tests that flip llm_client._client to force available/unavailable
    behave the same under either provider. Building it sends no request.
    """

    provider = "ollama"
    supports_batch = False

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        fallback_model: str | None = None,
        embed_model: str | None = None,
        timeout: float | None = None,
        max_retries: int | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = (base_url or settings.OLLAMA_BASE_URL).rstrip("/")
        self.model = model or settings.OLLAMA_MODEL
        fb = settings.OLLAMA_FALLBACK_MODEL if fallback_model is None else fallback_model
        self.fallback_model = fb if fb and fb != self.model else ""
        self.embed_model = embed_model or settings.OLLAMA_EMBED_MODEL
        # An explicit timeout (tests) applies to every request; otherwise each
        # request takes the interactive or background value (see background()).
        self._fixed_timeout = timeout
        self.timeout = timeout if timeout is not None else settings.OLLAMA_TIMEOUT_INTERACTIVE_SECONDS
        self.max_retries = max_retries if max_retries is not None else settings.OLLAMA_MAX_RETRIES
        self._transport = transport
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=httpx.Timeout(self.timeout, connect=5.0),
            transport=transport,
        )

    @property
    def available(self) -> bool:
        return self._client is not None

    def request_timeout(self) -> float:
        """Seconds one request may take: the fixed timeout if one was given,
        else OLLAMA_TIMEOUT_BACKGROUND_SECONDS inside background(), else
        OLLAMA_TIMEOUT_INTERACTIVE_SECONDS."""
        if self._fixed_timeout is not None:
            return self._fixed_timeout
        if _BACKGROUND.get():
            return settings.OLLAMA_TIMEOUT_BACKGROUND_SECONDS
        return settings.OLLAMA_TIMEOUT_INTERACTIVE_SECONDS

    # -- request plumbing ----------------------------------------------------

    def _payload(
        self, model: str, messages: list[dict], fmt, max_tokens: int, stream: bool, temperature: float
    ) -> dict:
        body = {
            "model": model,
            "messages": messages,
            "stream": stream,
            "options": {
                "num_ctx": settings.OLLAMA_NUM_CTX,
                "num_predict": max_tokens,
                "temperature": temperature,
            },
        }
        if fmt is not None:
            body["format"] = fmt
        keep_alive = self._keep_alive()
        if keep_alive is not None:
            body["keep_alive"] = keep_alive
        return body

    @staticmethod
    def _keep_alive():
        """settings.OLLAMA_KEEP_ALIVE in the form Ollama's API takes: a number
        of seconds as a number ("-1" -> -1), a duration as a string ("30m")."""
        value = (settings.OLLAMA_KEEP_ALIVE or "").strip()
        if not value:
            return None
        try:
            return int(value)
        except ValueError:
            return value

    @staticmethod
    def _is_model_missing(response: httpx.Response) -> bool:
        return response.status_code == 404 and "not found" in response.text.lower()

    def _post(self, path: str, build_payload, models: list[str]) -> dict:
        """POST to Ollama with retries on transport errors and 5xx, trying the
        next model only when the current one isn't pulled. `build_payload(model)`
        returns the request body."""
        last_error: LLMProviderError | None = None
        for model in models:
            for attempt in range(self.max_retries + 1):
                try:
                    limit = self.request_timeout()
                    response = self._client.post(path, json=build_payload(model), timeout=httpx.Timeout(limit, connect=5.0))
                except httpx.TimeoutException as exc:
                    last_error = LLMProviderError(f"Ollama timed out after {limit}s", "timeout")
                    last_error.__cause__ = exc
                except httpx.TransportError as exc:
                    last_error = LLMProviderError(f"Ollama unreachable at {self.base_url}: {exc}", "unreachable")
                    last_error.__cause__ = exc
                else:
                    if response.status_code == 200:
                        if model != models[0]:
                            logger.warning("Ollama model %s unavailable; answered by fallback %s", models[0], model)
                        return response.json()
                    if self._is_model_missing(response):
                        last_error = LLMProviderError(f"Ollama model '{model}' is not pulled", "model_missing")
                        break  # try the next model, not the same one again
                    last_error = LLMProviderError(
                        f"Ollama returned HTTP {response.status_code}: {response.text[:200]}", "http"
                    )
                    if response.status_code < 500:
                        raise last_error
                if attempt < self.max_retries:
                    _sleep(min(0.5 * 2**attempt, 4.0))
            else:
                # Retries exhausted on a transport error or 5xx. Another model
                # will not fix an unreachable or failing server.
                raise last_error
        assert last_error is not None
        raise last_error  # every model was missing

    def _chat_models(self, model: str | None = None) -> list[str]:
        """The model to ask, then the ones to fall back to if it isn't pulled.
        A per-call `model` (the JD analyzer's OLLAMA_ANALYZER_MODEL) comes
        first, then OLLAMA_MODEL, then OLLAMA_FALLBACK_MODEL."""
        chain = ([model] if model else []) + [self.model] + ([self.fallback_model] if self.fallback_model else [])
        return list(dict.fromkeys(chain))

    def _post_chat(self, messages: list[dict], fmt, max_tokens: int, model: str | None = None) -> dict:
        """POST /api/chat for a structured or JSON-mode answer: temperature
        comes from OLLAMA_TEMPERATURE (0 by default; extraction and scoring
        must be repeatable)."""
        return self._post(
            "/api/chat",
            lambda name: self._payload(name, messages, fmt, max_tokens, False, settings.OLLAMA_TEMPERATURE),
            self._chat_models(model),
        )

    @staticmethod
    def _content(reply: dict) -> str:
        return ((reply.get("message") or {}).get("content")) or ""

    @staticmethod
    def _check_not_truncated(reply: dict, what: str, max_tokens: int) -> None:
        """Raise "truncated" when Ollama stopped at the output cap
        (done_reason "length"). A cut-off reply is never re-asked: the same
        input under the same cap is cut off again, after minutes of decoding.
        The caller keeps what other calls found, or falls back to rules."""
        if reply.get("done_reason") == "length":
            logger.warning("Ollama %s reply hit the output cap (%d tokens); not re-asked", what, max_tokens)
            raise LLMProviderError(
                f"Ollama reply for {what} was cut off at the output cap ({max_tokens} tokens)", "truncated"
            )

    # -- the ClaudeClient surface -------------------------------------------

    def complete_json(self, system: str, user: str, max_tokens: int = 1500) -> str:
        reply = self._post_chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "json",
            max_tokens,
        )
        self._check_not_truncated(reply, "a JSON reply", max_tokens)
        return self._content(reply)

    def complete_tool_json(
        self, system: str, user: str, tool_name: str, input_schema: dict, max_tokens: int = 1500,
        model: str | None = None,
    ) -> dict:
        messages = [
            {
                "role": "system",
                "content": f"{system}\n\nRespond with only a JSON object that matches the provided schema ({tool_name}).",
            },
            {"role": "user", "content": user},
        ]
        problem = "no reply"
        for _attempt in range(self.max_retries + 1):
            reply = self._post_chat(messages, input_schema, max_tokens, model=model)
            # Cut off at the output cap: not re-asked (see _check_not_truncated).
            # Malformed JSON that was not cut off is re-asked below as before.
            self._check_not_truncated(reply, tool_name, max_tokens)
            content = self._content(reply)
            try:
                value = json.loads(content.strip(), strict=False)
                problem = validate_against_schema(value, input_schema) or ""
            except ValueError as exc:
                value, problem = None, f"not valid JSON ({exc})"
            if not problem:
                return value
            logger.warning("Ollama %s reply rejected: %s", tool_name, problem)
            messages = messages + [
                {"role": "assistant", "content": content},
                {
                    "role": "user",
                    "content": f"That reply was rejected: {problem}. Reply again with only the corrected JSON object.",
                },
            ]
        raise LLMProviderError(f"Ollama never returned schema-valid JSON for {tool_name}: {problem}", "bad_output")

    async def stream_message(
        self, system: str, messages: list[dict], max_tokens: int = 1500
    ) -> AsyncIterator[str]:
        """Yield text deltas from a streamed /api/chat (newline-delimited JSON)."""
        convo = [{"role": "system", "content": system}] + list(messages)
        models = self._chat_models()
        limit = self.request_timeout()
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(limit, connect=5.0),
            transport=self._transport,
        ) as client:
            for model in models:
                try:
                    async with client.stream(
                        "POST",
                        "/api/chat",
                        json=self._payload(model, convo, None, max_tokens, True, settings.OLLAMA_CHAT_TEMPERATURE),
                    ) as response:
                        if response.status_code != 200:
                            body = (await response.aread()).decode("utf-8", "replace")
                            if response.status_code == 404 and "not found" in body.lower() and model != models[-1]:
                                continue
                            kind = "model_missing" if response.status_code == 404 else "http"
                            raise LLMProviderError(f"Ollama returned HTTP {response.status_code}: {body[:200]}", kind)
                        async for line in response.aiter_lines():
                            if not line.strip():
                                continue
                            try:
                                chunk = json.loads(line)
                            except ValueError as exc:
                                raise LLMProviderError(
                                    f"Ollama sent a stream line that is not JSON: {line[:80]!r}", "bad_output"
                                ) from exc
                            text = (chunk.get("message") or {}).get("content") or ""
                            if text:
                                yield text
                            if chunk.get("done"):
                                if chunk.get("done_reason") == "length":
                                    # Already streamed to the reader; say so in the log.
                                    logger.warning("Ollama chat reply hit the output cap (%d tokens)", max_tokens)
                                return
                        return
                except httpx.TimeoutException as exc:
                    raise LLMProviderError(f"Ollama timed out after {limit}s", "timeout") from exc
                except httpx.TransportError as exc:
                    raise LLMProviderError(f"Ollama unreachable at {self.base_url}: {exc}", "unreachable") from exc

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embedding vectors for `texts`, in order, from OLLAMA_EMBED_MODEL via
        /api/embed. There is no fallback model: a different embedding model
        produces vectors that cannot be compared with these."""
        if not texts:
            return []
        def payload(model: str) -> dict:
            body = {"model": model, "input": texts, "options": {"num_ctx": settings.OLLAMA_NUM_CTX}}
            keep_alive = self._keep_alive()
            if keep_alive is not None:
                body["keep_alive"] = keep_alive
            return body

        reply = self._post("/api/embed", payload, [self.embed_model])
        vectors = reply.get("embeddings")
        valid = (
            isinstance(vectors, list)
            and len(vectors) == len(texts)
            and all(
                isinstance(v, list) and v and all(isinstance(x, (int, float)) for x in v) for v in vectors
            )
        )
        if not valid:
            raise LLMProviderError(
                f"Ollama returned malformed embeddings for {len(texts)} text(s)", "bad_output"
            )
        return vectors

    def health(self) -> dict:
        """Cheap reachability and installed-model check (GET /api/tags, 3s).

        ok          chat model and embedding model are both pulled
        degraded    a chat model is pulled but something is missing (the
                    primary chat model, or the embedding model)
        unavailable Ollama unreachable, or no chat model pulled at all
        """
        info = {
            "provider": self.provider,
            "status": "unavailable",
            "reachable": False,
            "model": self.model,
            "model_installed": False,
            "fallback_model": self.fallback_model or None,
            "fallback_installed": False,
            "embed_model": self.embed_model,
            "embed_model_installed": False,
            "models_pulled": [],
            "anthropic_key_configured": bool(settings.ANTHROPIC_API_KEY),
        }
        try:
            response = self._client.get("/api/tags", timeout=3.0)
            response.raise_for_status()
            names = sorted({m.get("name", "") for m in response.json().get("models", []) if m.get("name")})
        except (httpx.HTTPError, ValueError, AttributeError) as exc:
            info["error"] = type(exc).__name__
            return info

        def installed(model: str) -> bool:
            return bool(model) and (model in names or f"{model}:latest" in names)

        info["reachable"] = True
        info["models_pulled"] = names
        info["model_installed"] = installed(self.model)
        info["fallback_installed"] = installed(self.fallback_model)
        info["embed_model_installed"] = installed(self.embed_model)
        if info["model_installed"] and info["embed_model_installed"]:
            info["status"] = "ok"
        elif info["model_installed"] or info["fallback_installed"]:
            info["status"] = "degraded"
        return info


def describe_problems(info: dict) -> list[str]:
    """Plain-language fixes for whatever a provider health() dict says is wrong.
    Empty list when nothing is. Used by the startup log and nothing else, so
    the wording is free to name the commands the operator must run."""
    if info.get("provider") != "ollama":
        return []
    if not info.get("reachable"):
        return [
            f"Ollama is not running at {settings.OLLAMA_BASE_URL}. Start it with `ollama serve` "
            "(or open the Ollama app); AI features answer 503 until it is up."
        ]
    problems = []
    if not info.get("model_installed"):
        fallback = " Only the fallback model is installed." if info.get("fallback_installed") else ""
        problems.append(f"Chat model '{info['model']}' is not pulled. Run `ollama pull {info['model']}`.{fallback}")
    if not info.get("embed_model_installed"):
        problems.append(
            f"Embedding model '{info['embed_model']}' is not pulled. Run `ollama pull {info['embed_model']}`."
        )
    return problems


def build_llm_client(provider: str | None = None):
    """The client for settings.LLM_PROVIDER. A typo fails loudly at import
    instead of silently picking one."""
    name = (provider or settings.LLM_PROVIDER or "").strip().lower()
    if name == "ollama":
        return OllamaClient()
    if name == "anthropic":
        return ClaudeClient()
    raise RuntimeError(f"LLM_PROVIDER must be 'ollama' or 'anthropic', got {name!r}")


def parse_json_response(raw: str) -> dict:
    """Pull the first {...} JSON object out of an LLM response and parse it.

    strict=False tolerates literal control characters (e.g. unescaped newlines)
    inside JSON string values — common when a field holds multi-paragraph text
    rather than a short label, and the model doesn't escape them as \\n."""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise ValueError("No JSON object found in LLM response")
    return json.loads(match.group(0), strict=False)


llm_client = build_llm_client()
