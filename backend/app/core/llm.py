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
        """Ask Claude for a response and return the raw text (expected to contain JSON)."""
        if not self._client:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured")
        response = self._client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(block.text for block in response.content if block.type == "text")


def parse_json_response(raw: str) -> dict:
    """Pull the first {...} JSON object out of an LLM response and parse it."""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise ValueError("No JSON object found in LLM response")
    return json.loads(match.group(0))


llm_client = ClaudeClient()
