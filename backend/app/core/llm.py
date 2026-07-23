import json
import re

from anthropic import Anthropic

from app.core.config import settings


class ClaudeClient:
    """Thin wrapper around the Anthropic Messages API, shared across modules."""

    def __init__(self) -> None:
        self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY) if settings.ANTHROPIC_API_KEY else None

    @property
    def available(self) -> bool:
        return self._client is not None

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
        self, system: str, user: str, tool_name: str, input_schema: dict, max_tokens: int = 1500
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


def parse_json_response(raw: str) -> dict:
    """Pull the first {...} JSON object out of an LLM response and parse it.

    strict=False tolerates literal control characters (e.g. unescaped newlines)
    inside JSON string values — common when a field holds multi-paragraph text
    rather than a short label, and the model doesn't escape them as \\n."""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise ValueError("No JSON object found in LLM response")
    return json.loads(match.group(0), strict=False)


llm_client = ClaudeClient()
