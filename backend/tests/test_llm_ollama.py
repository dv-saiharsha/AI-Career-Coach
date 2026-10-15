"""The Ollama provider behind llm_client, the provider switch, /health/llm, and
the two small scoring-model fixes shipped with it.

Every Ollama call here goes through httpx.MockTransport. Nothing opens a
socket, so these pass on a machine with no Ollama and cannot spend anything.
"""

import json
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core import llm as llm_module
from app.core.llm import (
    ClaudeClient,
    LLMProvider,
    LLMProviderError,
    OllamaClient,
    build_llm_client,
    describe_problems,
    validate_against_schema,
)

SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "skills": {"type": "array", "items": {"type": "string"}},
        "level": {"type": ["string", "null"], "enum": ["junior", "senior", None]},
    },
    "required": ["title", "skills"],
}


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch):
    monkeypatch.setattr(llm_module, "_sleep", lambda _s: None)


def chat_reply(content: str, model: str = "llama3.1") -> dict:
    return {"model": model, "message": {"role": "assistant", "content": content}, "done": True}


def make_client(handler, **kwargs) -> tuple[OllamaClient, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    client = OllamaClient(
        base_url="http://ollama.test",
        model="llama3.1",
        fallback_model="llama3.2",
        timeout=5,
        max_retries=kwargs.pop("max_retries", 2),
        transport=httpx.MockTransport(wrapped),
        **kwargs,
    )
    return client, seen


def tags(*names):
    return lambda r: httpx.Response(200, json={"models": [{"name": n} for n in names]})


def healthy_ollama() -> OllamaClient:
    client, _ = make_client(tags("llama3.1:latest", "nomic-embed-text:latest"))
    return client


# --- schema validation -----------------------------------------------------


class TestValidateAgainstSchema:
    def test_accepts_a_conforming_value(self):
        assert validate_against_schema({"title": "x", "skills": ["a"], "level": None}, SCHEMA) is None

    def test_rejects_a_missing_required_field(self):
        assert "missing required field 'skills'" in validate_against_schema({"title": "x"}, SCHEMA)

    def test_rejects_a_wrong_type_nested_in_an_array(self):
        problem = validate_against_schema({"title": "x", "skills": ["a", 3]}, SCHEMA)
        assert problem and "skills[1]" in problem

    def test_rejects_a_value_outside_the_enum(self):
        assert validate_against_schema({"title": "x", "skills": [], "level": "wizard"}, SCHEMA)

    def test_a_bool_is_not_an_integer(self):
        assert validate_against_schema(True, {"type": "integer"})

    def test_a_list_of_types_allows_null(self):
        assert validate_against_schema(None, {"type": ["string", "null"]}) is None

    def test_unknown_keywords_are_ignored_not_rejected(self):
        assert validate_against_schema("x", {"type": "string", "minLength": 99}) is None


# --- structured output (the complete_tool_json contract) --------------------


class TestCompleteToolJson:
    def test_returns_the_parsed_object_and_sends_the_schema_as_format(self):
        client, seen = make_client(
            lambda r: httpx.Response(200, json=chat_reply('{"title": "Backend", "skills": ["Python"]}'))
        )
        result = client.complete_tool_json("You extract.", "Job text", "extract_job", SCHEMA, max_tokens=321)

        assert result == {"title": "Backend", "skills": ["Python"]}
        assert len(seen) == 1
        body = json.loads(seen[0].content)
        assert seen[0].url.path == "/api/chat"
        assert body["model"] == "llama3.1"
        assert body["stream"] is False
        assert body["format"] == SCHEMA
        assert body["options"]["num_predict"] == 321
        assert body["options"]["num_ctx"] >= 8192
        assert [m["role"] for m in body["messages"]] == ["system", "user"]
        assert body["messages"][0]["content"].startswith("You extract.")
        assert body["messages"][1]["content"] == "Job text"

    def test_reasks_with_the_problem_named_when_the_shape_is_wrong(self):
        replies = iter(['{"title": "Backend"}', '{"title": "Backend", "skills": ["Python"]}'])
        client, seen = make_client(lambda r: httpx.Response(200, json=chat_reply(next(replies))))

        assert client.complete_tool_json("s", "u", "t", SCHEMA)["skills"] == ["Python"]

        second = json.loads(seen[1].content)["messages"]
        assert second[-2] == {"role": "assistant", "content": '{"title": "Backend"}'}
        assert "missing required field 'skills'" in second[-1]["content"]

    def test_invalid_json_text_is_reasked_too(self):
        replies = iter(["Sure! Here is the JSON:", '{"title": "T", "skills": []}'])
        client, _ = make_client(lambda r: httpx.Response(200, json=chat_reply(next(replies))))
        assert client.complete_tool_json("s", "u", "t", SCHEMA) == {"title": "T", "skills": []}

    def test_gives_up_with_bad_output_after_the_retries(self):
        client, seen = make_client(lambda r: httpx.Response(200, json=chat_reply("not json")), max_retries=1)
        with pytest.raises(LLMProviderError) as err:
            client.complete_tool_json("s", "u", "t", SCHEMA)
        assert err.value.kind == "bad_output"
        assert len(seen) == 2  # 1 + max_retries, never an unbounded loop


# --- transport failures ----------------------------------------------------


class TestFailures:
    def test_unreachable_server_retries_then_raises_unreachable(self):
        def refuse(request):
            raise httpx.ConnectError("connection refused")

        client, seen = make_client(refuse, max_retries=2)
        with pytest.raises(LLMProviderError) as err:
            client.complete_tool_json("s", "u", "t", SCHEMA)
        assert err.value.kind == "unreachable"
        assert len(seen) == 3
        # An unreachable server is not helped by a different model.
        assert {json.loads(r.content)["model"] for r in seen} == {"llama3.1"}

    def test_timeout_is_reported_as_a_timeout(self):
        def slow(request):
            raise httpx.ReadTimeout("slow")

        client, _ = make_client(slow, max_retries=0)
        with pytest.raises(LLMProviderError) as err:
            client.complete_json("s", "u")
        assert err.value.kind == "timeout"

    def test_a_5xx_is_retried_and_can_recover(self):
        answers = iter([httpx.Response(503, text="busy"), httpx.Response(200, json=chat_reply("{}"))])
        client, seen = make_client(lambda r: next(answers))
        assert client.complete_json("s", "u") == "{}"
        assert len(seen) == 2

    def test_a_4xx_is_not_retried(self):
        client, seen = make_client(lambda r: httpx.Response(400, text="bad request"))
        with pytest.raises(LLMProviderError) as err:
            client.complete_json("s", "u")
        assert err.value.kind == "http"
        assert len(seen) == 1

    def test_failure_is_a_runtime_error_so_existing_503_mappings_apply(self):
        assert issubclass(LLMProviderError, RuntimeError)


# --- the fallback model ----------------------------------------------------


class TestFallbackModel:
    def test_uses_the_fallback_only_when_the_primary_is_not_pulled(self):
        def handler(request):
            model = json.loads(request.content)["model"]
            if model == "llama3.1":
                return httpx.Response(404, json={"error": "model 'llama3.1' not found"})
            return httpx.Response(200, json=chat_reply('{"title": "T", "skills": []}', model))

        client, seen = make_client(handler)
        assert client.complete_tool_json("s", "u", "t", SCHEMA) == {"title": "T", "skills": []}
        assert [json.loads(r.content)["model"] for r in seen] == ["llama3.1", "llama3.2"]

    def test_both_models_missing_raises_model_missing(self):
        client, _ = make_client(lambda r: httpx.Response(404, json={"error": "model not found"}))
        with pytest.raises(LLMProviderError) as err:
            client.complete_json("s", "u")
        assert err.value.kind == "model_missing"

    def test_no_fallback_configured_means_a_single_model(self):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(404, json={"error": "model not found"})

        client = OllamaClient(
            base_url="http://ollama.test", model="llama3.1", fallback_model="",
            max_retries=0, transport=httpx.MockTransport(handler),
        )
        with pytest.raises(LLMProviderError):
            client.complete_json("s", "u")
        assert len(seen) == 1


# --- complete_json and streaming -------------------------------------------


class TestCompleteJson:
    def test_asks_for_json_mode_and_returns_the_raw_text(self):
        client, seen = make_client(lambda r: httpx.Response(200, json=chat_reply('{"a": 1}')))
        assert client.complete_json("sys", "usr", max_tokens=99) == '{"a": 1}'
        body = json.loads(seen[0].content)
        assert body["format"] == "json"
        assert body["options"]["num_predict"] == 99


class TestStreamMessage:
    @staticmethod
    def _ndjson(*chunks: dict) -> bytes:
        return ("\n".join(json.dumps(c) for c in chunks) + "\n").encode()

    @pytest.mark.asyncio
    async def test_yields_text_deltas_in_order_and_stops_at_done(self):
        payload = self._ndjson(
            {"message": {"role": "assistant", "content": "Hel"}, "done": False},
            {"message": {"role": "assistant", "content": "lo"}, "done": False},
            {"message": {"role": "assistant", "content": ""}, "done": True},
            {"message": {"role": "assistant", "content": "never"}, "done": False},
        )
        client, seen = make_client(lambda r: httpx.Response(200, content=payload))

        pieces = [t async for t in client.stream_message("sys", [{"role": "user", "content": "hi"}])]

        assert pieces == ["Hel", "lo"]
        body = json.loads(seen[0].content)
        assert body["stream"] is True
        assert body["messages"][0] == {"role": "system", "content": "sys"}
        assert body["messages"][1] == {"role": "user", "content": "hi"}

    @pytest.mark.asyncio
    async def test_a_dead_server_raises_unreachable(self):
        def refuse(request):
            raise httpx.ConnectError("refused")

        client, _ = make_client(refuse)
        with pytest.raises(LLMProviderError) as err:
            _ = [t async for t in client.stream_message("s", [{"role": "user", "content": "x"}])]
        assert err.value.kind == "unreachable"


# --- availability and health ------------------------------------------------


class TestAvailabilityAndHealth:
    def test_building_a_client_sends_no_request(self):
        client, seen = make_client(lambda r: httpx.Response(200, json={}))
        assert client.available is True
        assert seen == []

    def test_flipping__client_forces_unavailable_like_the_claude_client(self):
        client, _ = make_client(lambda r: httpx.Response(200, json={}))
        client._client = None
        assert client.available is False

    def _tags(self, *names):
        return lambda r: httpx.Response(200, json={"models": [{"name": n} for n in names]})

    def test_ok_when_the_chat_and_embedding_models_are_pulled(self):
        client, _ = make_client(self._tags("llama3.1:latest", "llama3.2:latest", "nomic-embed-text:latest"))
        info = client.health()
        assert info["status"] == "ok"
        assert info["reachable"] and info["model_installed"] and info["fallback_installed"]
        assert info["embed_model"] == "nomic-embed-text" and info["embed_model_installed"] is True
        assert info["models_pulled"] == ["llama3.1:latest", "llama3.2:latest", "nomic-embed-text:latest"]

    def test_degraded_when_the_embedding_model_is_missing(self):
        client, _ = make_client(self._tags("llama3.1:latest"))
        info = client.health()
        assert info["status"] == "degraded"
        assert info["model_installed"] is True and info["embed_model_installed"] is False

    def test_degraded_when_only_the_fallback_is_pulled(self):
        client, _ = make_client(self._tags("llama3.2:latest"))
        info = client.health()
        assert info["status"] == "degraded"
        assert info["model_installed"] is False and info["fallback_installed"] is True

    def test_unavailable_when_nothing_usable_is_pulled(self):
        client, _ = make_client(self._tags("nomic-embed-text:latest"))
        assert client.health()["status"] == "unavailable"

    def test_unreachable_is_reported_not_raised(self):
        def refuse(request):
            raise httpx.ConnectError("refused")

        client, _ = make_client(refuse)
        info = client.health()
        assert info["status"] == "unavailable"
        assert info["reachable"] is False
        assert info["error"] == "ConnectError"

    def test_health_never_posts_a_completion(self):
        client, seen = make_client(self._tags("llama3.1:latest"))
        client.health()
        assert [(r.method, r.url.path) for r in seen] == [("GET", "/api/tags")]


# --- provider switch -------------------------------------------------------


class TestProviderSwitch:
    def test_ollama_and_anthropic_are_selectable(self):
        assert isinstance(build_llm_client("ollama"), OllamaClient)
        assert isinstance(build_llm_client("Anthropic "), ClaudeClient)

    def test_a_typo_fails_loudly(self):
        with pytest.raises(RuntimeError, match="LLM_PROVIDER"):
            build_llm_client("ollamaa")

    def test_the_default_comes_from_settings(self, monkeypatch):
        monkeypatch.setattr(llm_module.settings, "LLM_PROVIDER", "ollama")
        assert build_llm_client().provider == "ollama"

    def test_only_the_claude_client_supports_the_batch_api(self):
        assert ClaudeClient.supports_batch is True
        assert OllamaClient.supports_batch is False

    def test_claude_health_is_config_only(self, monkeypatch):
        monkeypatch.setattr(llm_module.settings, "ANTHROPIC_API_KEY", "")
        info = ClaudeClient().health()
        assert info == {
            "provider": "anthropic", "status": "unavailable",
            "model": llm_module.settings.ANTHROPIC_MODEL, "anthropic_key_configured": False,
        }

    def test_suite_runs_with_a_blank_claude_key(self):
        assert llm_module.settings.ANTHROPIC_API_KEY == ""


# --- /health/llm and the global 503 ----------------------------------------


@pytest.fixture
def app_client(monkeypatch):
    from app import main

    return main, TestClient(main.app, raise_server_exceptions=False)


class TestHealthEndpoint:
    def test_ok_returns_200_and_never_the_key(self, app_client, monkeypatch):
        main, http = app_client
        client, _ = make_client(
            lambda r: httpx.Response(
                200, json={"models": [{"name": "llama3.1:latest"}, {"name": "nomic-embed-text:latest"}]}
            )
        )
        monkeypatch.setattr(main, "llm_client", client)
        monkeypatch.setattr(main.settings, "ANTHROPIC_API_KEY", "sk-ant-super-secret")

        response = http.get("/health/llm")

        assert response.status_code == 200
        body = response.json()
        assert body["provider"] == "ollama" and body["status"] == "ok"
        assert body["model"] == "llama3.1" and body["reachable"] is True
        assert "llama3.1:latest" in body["models_pulled"]
        assert body["anthropic_key_configured"] is True
        assert "sk-ant-super-secret" not in response.text
        assert "ats_scoring_model_installed" in body

    def test_503_when_ollama_is_down(self, app_client, monkeypatch):
        main, http = app_client

        def refuse(request):
            raise httpx.ConnectError("refused")

        client, _ = make_client(refuse)
        monkeypatch.setattr(main, "llm_client", client)
        response = http.get("/health/llm")
        assert response.status_code == 503
        assert response.json()["reachable"] is False

    def test_anthropic_provider_reports_without_a_network_call(self, app_client, monkeypatch):
        main, http = app_client
        monkeypatch.setattr(main, "llm_client", ClaudeClient())
        body = http.get("/health/llm").json()
        assert body["provider"] == "anthropic"


class TestGlobalHandler:
    def _app_with_failing_route(self, main, kind):
        @main.app.get(f"/__boom_{kind}")
        def boom():
            raise LLMProviderError("internal detail: connect to 127.0.0.1:11434 failed", kind)

        return TestClient(main.app, raise_server_exceptions=False)

    def test_a_stopped_ollama_says_so_and_names_the_fix_without_leaking_the_address(self, app_client):
        main, _ = app_client
        response = self._app_with_failing_route(main, "unreachable").get("/__boom_unreachable")
        assert response.status_code == 503
        assert "Ollama is not running" in response.json()["detail"]
        assert "ollama serve" in response.json()["detail"]
        assert "11434" not in response.text and "127.0.0.1" not in response.text

    def test_a_missing_model_names_the_pull_command(self, app_client):
        main, _ = app_client
        response = self._app_with_failing_route(main, "model_missing").get("/__boom_model_missing")
        assert response.status_code == 503
        assert f"ollama pull {main.settings.OLLAMA_MODEL}" in response.json()["detail"]
        assert "127.0.0.1" not in response.text

    def test_unusable_output_is_a_503_not_a_500(self, app_client):
        main, _ = app_client
        response = self._app_with_failing_route(main, "bad_output").get("/__boom_bad_output")
        assert response.status_code == 503
        assert "couldn't use" in response.json()["detail"]

    def test_any_other_provider_failure_gets_the_generic_message(self, app_client):
        main, _ = app_client
        response = self._app_with_failing_route(main, "http").get("/__boom_http")
        assert response.status_code == 503
        assert "temporarily unavailable" in response.json()["detail"]
        assert "127.0.0.1" not in response.text

    def test_a_timeout_says_so(self, app_client):
        main, _ = app_client
        response = self._app_with_failing_route(main, "timeout").get("/__boom_timeout")
        assert response.status_code == 503
        assert "too long" in response.json()["detail"]


# --- production startup check -----------------------------------------------


class TestValidateStartup:
    def _production(self, monkeypatch, **overrides):
        from app.core import config

        values = {
            "ENVIRONMENT": "production",
            "DB_URL": "postgresql://x/y",
            "FIREBASE_PROJECT_ID": "p",
            "ALLOWED_ORIGINS": "https://app.example.com",
            "LLM_PROVIDER": "ollama",
            "OLLAMA_BASE_URL": "http://ollama.internal:11434",
            "ANTHROPIC_API_KEY": "",
        }
        values.update(overrides)
        for key, value in values.items():
            monkeypatch.setattr(config.settings, key, value)
        return config

    def test_ollama_with_a_real_host_boots_without_a_claude_key(self, monkeypatch):
        self._production(monkeypatch).validate_startup()

    def test_ollama_on_localhost_is_allowed_this_is_a_local_phase(self, monkeypatch):
        config = self._production(monkeypatch, OLLAMA_BASE_URL="http://localhost:11434")
        config.validate_startup()  # no raise: reachability is a startup warning, not a refusal

    def test_anthropic_still_requires_its_key(self, monkeypatch):
        config = self._production(monkeypatch, LLM_PROVIDER="anthropic")
        with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
            config.validate_startup()

    def test_an_unknown_provider_is_refused(self, monkeypatch):
        config = self._production(monkeypatch, LLM_PROVIDER="gpt")
        with pytest.raises(RuntimeError, match="LLM_PROVIDER"):
            config.validate_startup()

    def test_development_never_blocks(self, monkeypatch):
        config = self._production(monkeypatch, ENVIRONMENT="development", LLM_PROVIDER="gpt")
        config.validate_startup()


# --- the missing scoring model ---------------------------------------------


class TestMissingScoringModel:
    PAYLOAD = {
        "candidate_name": "Ada Lovelace", "email": "ada@example.com", "job_description": "Python",
        "technical_skills": ["Python"], "experiences": [], "education": [],
    }

    def test_startup_logs_one_clear_warning_when_the_model_file_is_missing(self, monkeypatch, caplog):
        from app import main

        monkeypatch.setattr(main, "llm_client", healthy_ollama())
        monkeypatch.setattr(main.inference, "model_available", lambda: False)
        with caplog.at_level(logging.WARNING, logger="app.main"):
            main.log_startup_state()

        warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
        assert len(warnings) == 1
        assert "ATS scoring model not found" in warnings[0]
        assert "compile-and-score" in warnings[0] and "train_ats_model.py" in warnings[0]

    def test_no_warning_when_the_model_is_installed(self, monkeypatch, caplog):
        from app import main

        monkeypatch.setattr(main, "llm_client", healthy_ollama())
        monkeypatch.setattr(main.inference, "model_available", lambda: True)
        with caplog.at_level(logging.WARNING, logger="app.main"):
            main.log_startup_state()
        assert not [r for r in caplog.records if r.levelno == logging.WARNING]

    def test_startup_warns_when_anthropic_is_selected_with_no_key(self, monkeypatch, caplog):
        from app import main

        monkeypatch.setattr(main.inference, "model_available", lambda: True)
        monkeypatch.setattr(main, "llm_client", ClaudeClient())
        monkeypatch.setattr(main.settings, "ANTHROPIC_API_KEY", "")
        with caplog.at_level(logging.WARNING, logger="app.main"):
            main.log_startup_state()
        assert any("ANTHROPIC_API_KEY is empty" in r.getMessage() for r in caplog.records)

    def test_compile_and_score_answers_503_in_words_not_a_500(self, monkeypatch):
        from app import main
        from app.core.deps import AuthenticatedUser, get_current_user
        from app.modules.resume_builder import services

        monkeypatch.setattr(services, "model_available", lambda: False)
        compiled = []
        monkeypatch.setattr(services.latex, "compile_tex_to_pdf", lambda tex: compiled.append(tex) or b"")
        main.app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            id="u1", email="u1@example.com"
        )
        try:
            response = TestClient(main.app, raise_server_exceptions=False).post(
                "/api/resume-builder/compile-and-score", json=self.PAYLOAD
            )
        finally:
            main.app.dependency_overrides.pop(get_current_user, None)

        assert response.status_code == 503, response.text
        assert "scoring model" in response.json()["detail"]
        assert compiled == []  # failed before spending a tectonic compile

    def test_the_model_loader_raises_the_named_error(self, monkeypatch, tmp_path):
        from app.ml import inference

        monkeypatch.setattr(inference, "MODEL_PATH", tmp_path / "missing.joblib")
        monkeypatch.setattr(inference, "_model", None)
        with pytest.raises(inference.ScoringModelUnavailable):
            inference.predict_score("resume", "jd")


# --- embeddings ------------------------------------------------------------


class TestEmbed:
    def test_posts_the_texts_to_api_embed_and_returns_vectors_in_order(self):
        client, seen = make_client(
            lambda r: httpx.Response(200, json={"embeddings": [[0.1, 0.2], [0.3, 0.4]]})
        )
        assert client.embed(["a", "b"]) == [[0.1, 0.2], [0.3, 0.4]]

        body = json.loads(seen[0].content)
        assert seen[0].url.path == "/api/embed"
        assert body["model"] == "nomic-embed-text"
        assert body["input"] == ["a", "b"]
        assert body["options"]["num_ctx"] >= 8192

    def test_no_texts_means_no_request(self):
        client, seen = make_client(lambda r: httpx.Response(200, json={}))
        assert client.embed([]) == []
        assert seen == []

    def test_a_count_mismatch_is_bad_output(self):
        client, _ = make_client(lambda r: httpx.Response(200, json={"embeddings": [[0.1]]}))
        with pytest.raises(LLMProviderError) as err:
            client.embed(["a", "b"])
        assert err.value.kind == "bad_output"

    @pytest.mark.parametrize("bad", [{}, {"embeddings": "x"}, {"embeddings": [[]]}, {"embeddings": [["a"]]}])
    def test_malformed_vectors_are_bad_output(self, bad):
        client, _ = make_client(lambda r: httpx.Response(200, json=bad))
        with pytest.raises(LLMProviderError) as err:
            client.embed(["a"])
        assert err.value.kind == "bad_output"

    def test_a_missing_embedding_model_is_reported_and_never_swapped_for_a_chat_model(self):
        client, seen = make_client(lambda r: httpx.Response(404, json={"error": "model not found"}))
        with pytest.raises(LLMProviderError) as err:
            client.embed(["a"])
        assert err.value.kind == "model_missing"
        assert [json.loads(r.content)["model"] for r in seen] == ["nomic-embed-text"]

    def test_an_unreachable_server_is_retried_then_reported(self):
        def refuse(request):
            raise httpx.ConnectError("refused")

        client, seen = make_client(refuse, max_retries=1)
        with pytest.raises(LLMProviderError) as err:
            client.embed(["a"])
        assert err.value.kind == "unreachable" and len(seen) == 2

    def test_anthropic_has_no_embeddings(self):
        with pytest.raises(LLMProviderError) as err:
            ClaudeClient().embed(["a"])
        assert err.value.kind == "unsupported"


# --- temperature and the provider interface --------------------------------


class TestTemperature:
    def test_structured_calls_default_to_temperature_zero(self):
        client, seen = make_client(lambda r: httpx.Response(200, json=chat_reply('{"title": "T", "skills": []}')))
        client.complete_tool_json("s", "u", "t", SCHEMA)
        client.complete_json("s", "u")
        assert [json.loads(r.content)["options"]["temperature"] for r in seen] == [0, 0]

    def test_the_structured_temperature_is_configurable(self, monkeypatch):
        monkeypatch.setattr(llm_module.settings, "OLLAMA_TEMPERATURE", 0.5)
        client, seen = make_client(lambda r: httpx.Response(200, json=chat_reply("{}")))
        client.complete_json("s", "u")
        assert json.loads(seen[0].content)["options"]["temperature"] == 0.5

    @pytest.mark.asyncio
    async def test_streaming_chat_uses_the_chat_temperature(self):
        payload = (json.dumps({"message": {"content": "hi"}, "done": True}) + "\n").encode()
        client, seen = make_client(lambda r: httpx.Response(200, content=payload))
        _ = [t async for t in client.stream_message("s", [{"role": "user", "content": "x"}])]
        assert json.loads(seen[0].content)["options"]["temperature"] == llm_module.settings.OLLAMA_CHAT_TEMPERATURE

    @pytest.mark.asyncio
    async def test_a_stream_line_that_is_not_json_is_bad_output(self):
        client, _ = make_client(lambda r: httpx.Response(200, content=b"not json at all\n"))
        with pytest.raises(LLMProviderError) as err:
            _ = [t async for t in client.stream_message("s", [{"role": "user", "content": "x"}])]
        assert err.value.kind == "bad_output"


class TestKeepAlive:
    """OLLAMA_KEEP_ALIVE rides on every /api/chat and /api/embed request, so
    the model stays loaded without any change to how `ollama serve` starts."""

    def test_the_default_is_thirty_minutes(self):
        assert llm_module.settings.OLLAMA_KEEP_ALIVE == "30m"

    def test_every_chat_and_embed_request_carries_it(self):
        def handler(request):
            if request.url.path == "/api/embed":
                return httpx.Response(200, json={"embeddings": [[0.1]]})
            return httpx.Response(200, json=chat_reply('{"title": "T", "skills": []}'))

        client, seen = make_client(handler)
        client.complete_tool_json("s", "u", "t", SCHEMA)
        client.complete_json("s", "u")
        client.embed(["x"])

        assert [r.url.path for r in seen] == ["/api/chat", "/api/chat", "/api/embed"]
        assert [json.loads(r.content)["keep_alive"] for r in seen] == ["30m", "30m", "30m"]

    @pytest.mark.asyncio
    async def test_streaming_chat_carries_it_too(self):
        payload = (json.dumps({"message": {"content": "hi"}, "done": True}) + "\n").encode()
        client, seen = make_client(lambda r: httpx.Response(200, content=payload))
        _ = [t async for t in client.stream_message("s", [{"role": "user", "content": "x"}])]
        assert json.loads(seen[0].content)["keep_alive"] == "30m"

    def test_it_is_configurable(self, monkeypatch):
        monkeypatch.setattr(llm_module.settings, "OLLAMA_KEEP_ALIVE", "2h")
        client, seen = make_client(lambda r: httpx.Response(200, json=chat_reply("{}")))
        client.complete_json("s", "u")
        assert json.loads(seen[0].content)["keep_alive"] == "2h"

    @pytest.mark.parametrize("configured,sent", [("-1", -1), ("0", 0), ("300", 300)])
    def test_a_number_of_seconds_is_sent_as_a_number(self, monkeypatch, configured, sent):
        monkeypatch.setattr(llm_module.settings, "OLLAMA_KEEP_ALIVE", configured)
        client, seen = make_client(lambda r: httpx.Response(200, json=chat_reply("{}")))
        client.complete_json("s", "u")
        body = json.loads(seen[0].content)
        assert body["keep_alive"] == sent and isinstance(body["keep_alive"], int)

    def test_empty_means_leave_ollamas_own_default(self, monkeypatch):
        monkeypatch.setattr(llm_module.settings, "OLLAMA_KEEP_ALIVE", "")
        client, seen = make_client(lambda r: httpx.Response(200, json=chat_reply("{}")))
        client.complete_json("s", "u")
        assert "keep_alive" not in json.loads(seen[0].content)

    def test_the_health_probe_does_not_send_a_model_request(self):
        client, seen = make_client(tags("llama3.1:latest"))
        client.health()
        assert all(r.method == "GET" for r in seen)


class TestProviderInterface:
    def test_both_providers_satisfy_the_interface(self):
        assert isinstance(ClaudeClient(), LLMProvider)
        assert isinstance(healthy_ollama(), LLMProvider)

    def test_the_shared_singleton_satisfies_it_too(self):
        assert isinstance(llm_module.llm_client, LLMProvider)


# --- startup checks --------------------------------------------------------


class TestStartupOllamaChecks:
    def _run(self, monkeypatch, caplog, handler):
        from app import main

        client, _ = make_client(handler)
        monkeypatch.setattr(main, "llm_client", client)
        monkeypatch.setattr(main.inference, "model_available", lambda: True)
        with caplog.at_level(logging.WARNING, logger="app.main"):
            main.log_startup_state()
        return [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]

    def test_a_healthy_ollama_logs_no_warning(self, monkeypatch, caplog):
        assert self._run(monkeypatch, caplog, tags("llama3.1:latest", "nomic-embed-text:latest")) == []

    def test_ollama_not_running_is_one_clear_warning(self, monkeypatch, caplog):
        def refuse(request):
            raise httpx.ConnectError("refused")

        warnings = self._run(monkeypatch, caplog, refuse)
        assert len(warnings) == 1
        assert "Ollama is not running" in warnings[0] and "ollama serve" in warnings[0]

    def test_a_missing_chat_model_names_the_pull_command(self, monkeypatch, caplog):
        warnings = self._run(monkeypatch, caplog, tags("nomic-embed-text:latest", "llama3.2:latest"))
        assert len(warnings) == 1
        assert "ollama pull llama3.1" in warnings[0]
        assert "fallback" in warnings[0]

    def test_a_missing_embedding_model_names_the_pull_command(self, monkeypatch, caplog):
        warnings = self._run(monkeypatch, caplog, tags("llama3.1:latest"))
        assert warnings == [
            "Embedding model 'nomic-embed-text' is not pulled. Run `ollama pull nomic-embed-text`."
        ]

    def test_both_missing_gives_two_warnings(self, monkeypatch, caplog):
        assert len(self._run(monkeypatch, caplog, tags("something-else:latest"))) == 2

    def test_describe_problems_is_silent_for_anthropic(self):
        assert describe_problems(ClaudeClient().health()) == []


# --- job enrichment: sequential under Ollama --------------------------------

FACTS = {
    "h1b_sponsorship": "unmentioned",
    "h1b_evidence": "",
    "experience_level": None,
    "employment_type": "full_time",
    "core_skills": ["Python", "SQL"],
    "summary": "Builds data pipelines.",
}


def pending_postings(n: int) -> dict[str, dict]:
    return {f"k{i}": {"title": f"Engineer {i}", "company": "Acme", "description": f"Role {i}"} for i in range(n)}


@pytest.fixture
def ingestion_with(monkeypatch):
    from app.modules.job_market import ingestion

    def install(handler, **kwargs):
        client, seen = make_client(handler, **kwargs)
        monkeypatch.setattr(ingestion, "llm_client", client)
        return ingestion, seen

    return install


class TestSequentialEnrichment:
    def test_enriches_each_posting_with_one_schema_constrained_request(self, ingestion_with):
        from app.modules.job_market import enrichment

        ingestion, seen = ingestion_with(lambda r: httpx.Response(200, json=chat_reply(json.dumps(FACTS))))
        report = ingestion.SweepReport(dry_run=False)

        facts = ingestion._enrich(pending_postings(3), report)

        assert set(facts) == {"k0", "k1", "k2"}
        assert facts["k1"]["core_skills"] == ["Python", "SQL"]
        assert report.newly_enriched == 3 and report.enrichment_failures == 0
        assert len(seen) == 3
        body = json.loads(seen[0].content)
        assert body["format"] == enrichment.ENRICHMENT_SCHEMA
        assert body["options"]["temperature"] == 0
        assert "Engineer 0" in body["messages"][1]["content"]

    def test_never_touches_the_anthropic_batch_api(self, ingestion_with):
        ingestion, seen = ingestion_with(lambda r: httpx.Response(200, json=chat_reply(json.dumps(FACTS))))
        assert ingestion.llm_client.supports_batch is False
        # No SDK client exists on the Ollama provider; reaching for one would raise AttributeError.
        assert not hasattr(ingestion.llm_client._client, "beta")
        ingestion._enrich(pending_postings(1), ingestion.SweepReport(dry_run=False))
        assert len(seen) == 1

    def test_a_run_is_capped_and_the_rest_wait_for_the_next_run(self, ingestion_with, monkeypatch):
        ingestion, seen = ingestion_with(lambda r: httpx.Response(200, json=chat_reply(json.dumps(FACTS))))
        monkeypatch.setattr(ingestion.settings, "OLLAMA_ENRICH_MAX_PER_RUN", 2)

        facts = ingestion._enrich(pending_postings(5), ingestion.SweepReport(dry_run=False))

        assert list(facts) == ["k0", "k1"]
        assert len(seen) == 2

    def test_a_cap_of_zero_turns_enrichment_off(self, ingestion_with, monkeypatch):
        ingestion, seen = ingestion_with(lambda r: httpx.Response(200, json=chat_reply(json.dumps(FACTS))))
        monkeypatch.setattr(ingestion.settings, "OLLAMA_ENRICH_MAX_PER_RUN", 0)
        assert ingestion._enrich(pending_postings(3), ingestion.SweepReport(dry_run=False)) == {}
        assert seen == []

    def test_a_failed_posting_is_left_unenriched_and_the_run_continues(self, ingestion_with):
        def handler(request):
            if "Role 1" in json.loads(request.content)["messages"][-1]["content"]:
                return httpx.Response(400, text="bad request")
            return httpx.Response(200, json=chat_reply(json.dumps(FACTS)))

        ingestion, _ = ingestion_with(handler)
        report = ingestion.SweepReport(dry_run=False)

        facts = ingestion._enrich(pending_postings(3), report)

        assert set(facts) == {"k0", "k2"}  # k1 is absent, so enriched_at stays NULL and it is retried
        assert report.enrichment_failures == 1 and report.newly_enriched == 2

    def test_unusable_replies_cost_that_posting_only(self, ingestion_with):
        def handler(request):
            if "Role 0" in json.loads(request.content)["messages"][1]["content"]:
                return httpx.Response(200, json=chat_reply("not json"))
            return httpx.Response(200, json=chat_reply(json.dumps(FACTS)))

        ingestion, _ = ingestion_with(handler, max_retries=1)
        report = ingestion.SweepReport(dry_run=False)
        facts = ingestion._enrich(pending_postings(2), report)
        assert set(facts) == {"k1"} and report.enrichment_failures == 1

    def test_a_stopped_ollama_ends_the_loop_after_the_first_posting(self, ingestion_with):
        def refuse(request):
            raise httpx.ConnectError("refused")

        ingestion, seen = ingestion_with(refuse, max_retries=0)
        report = ingestion.SweepReport(dry_run=False)

        assert ingestion._enrich(pending_postings(10), report) == {}
        assert len(seen) == 1  # not ten failed requests
        assert any("stopped early" in e for e in report.errors)

    def test_a_missing_model_ends_the_loop_too(self, ingestion_with):
        ingestion, seen = ingestion_with(
            lambda r: httpx.Response(404, json={"error": "model not found"}), max_retries=0
        )
        report = ingestion.SweepReport(dry_run=False)
        assert ingestion._enrich(pending_postings(10), report) == {}
        assert len(seen) == 2  # primary and fallback, once each
        assert any("stopped early" in e for e in report.errors)

    def test_nothing_pending_sends_nothing(self, ingestion_with):
        ingestion, seen = ingestion_with(lambda r: httpx.Response(200, json={}))
        assert ingestion._enrich({}, ingestion.SweepReport(dry_run=False)) == {}
        assert seen == []

    def test_an_unavailable_provider_reports_it_without_the_anthropic_wording(self, ingestion_with):
        ingestion, seen = ingestion_with(lambda r: httpx.Response(200, json={}))
        ingestion.llm_client._client = None
        report = ingestion.SweepReport(dry_run=False)
        assert ingestion._enrich(pending_postings(1), report) == {}
        assert report.errors == ["LLM provider unavailable — postings stored unenriched"]
        assert seen == []


class TestNormaliseFacts:
    def test_string_nulls_become_none_and_bad_verdicts_become_unmentioned(self):
        from app.modules.job_market import enrichment

        out = enrichment.normalise_facts(
            {"h1b_sponsorship": "maybe", "h1b_evidence": "quote", "experience_level": "null",
             "employment_type": "", "core_skills": ["Go", 3, None]}
        )
        assert out["h1b_sponsorship"] == "unmentioned"
        assert out["h1b_evidence"] == ""  # a quote never sits under "unmentioned"
        assert out["experience_level"] is None and out["employment_type"] is None
        assert out["core_skills"] == ["Go"]

    def test_the_batch_parser_still_goes_through_the_same_normalisation(self):
        from types import SimpleNamespace

        from app.modules.job_market import enrichment

        block = SimpleNamespace(type="tool_use", input={"h1b_sponsorship": "no_sponsorship", "h1b_evidence": "No visas."})
        out = enrichment.parse_enrichment(SimpleNamespace(content=[block]))
        assert out["h1b_sponsorship"] == "no_sponsorship" and out["h1b_evidence"] == "No visas."


class TestEvidenceIsAQuote:
    DESC = "We love Python.  We are UNABLE to sponsor visas at this time. Apply today."

    def _facts(self, verdict, evidence):
        from app.modules.job_market import enrichment

        return {**enrichment.UNENRICHED, "h1b_sponsorship": verdict, "h1b_evidence": evidence}

    def test_a_verbatim_quote_keeps_the_verdict_ignoring_case_and_spacing(self):
        from app.modules.job_market import enrichment

        facts = self._facts("no_sponsorship", "we are unable to sponsor visas at this time.")
        assert enrichment.verify_evidence(facts, self.DESC) == facts

    @pytest.mark.parametrize("fake", ["description", "They will not sponsor.", ""])
    def test_evidence_that_is_not_in_the_posting_downgrades_the_verdict(self, fake):
        from app.modules.job_market import enrichment

        out = enrichment.verify_evidence(self._facts("explicitly_sponsored", fake), self.DESC)
        assert out["h1b_sponsorship"] == "unmentioned" and out["h1b_evidence"] == ""

    def test_unmentioned_is_left_alone(self):
        from app.modules.job_market import enrichment

        facts = self._facts("unmentioned", "")
        assert enrichment.verify_evidence(facts, self.DESC) == facts

    def test_a_quote_from_past_the_truncation_point_does_not_count(self):
        from app.modules.job_market import enrichment

        late = "x " * (enrichment.MAX_DESCRIPTION_CHARS // 2) + "We will sponsor visas."
        out = enrichment.verify_evidence(self._facts("explicitly_sponsored", "We will sponsor visas."), late)
        assert out["h1b_sponsorship"] == "unmentioned"

    def test_extract_facts_applies_the_check_and_asks_for_a_copied_sentence(self):
        from app.modules.job_market import enrichment

        reply = {**FACTS, "h1b_sponsorship": "no_sponsorship", "h1b_evidence": "description"}
        client, seen = make_client(lambda r: httpx.Response(200, json=chat_reply(json.dumps(reply))))

        out = enrichment.extract_facts(client, "Engineer", "Acme", self.DESC)

        assert out["h1b_sponsorship"] == "unmentioned" and out["h1b_evidence"] == ""
        prompt = json.loads(seen[0].content)["messages"][1]["content"]
        assert "word for word" in prompt and self.DESC in prompt

    def test_the_batch_prompt_is_unchanged(self):
        from app.modules.job_market import enrichment

        params = enrichment.build_request_params("T", "C", "D")
        assert "word for word" not in params["messages"][0]["content"]


class TestCrawlerEnrichmentCap:
    def test_under_ollama_the_cap_is_the_per_run_request_count(self, monkeypatch):
        from app.modules.job_market import crawler, ingestion

        monkeypatch.setattr(ingestion, "llm_client", healthy_ollama())
        assert crawler._enrichment_request_cap() == ingestion.settings.OLLAMA_ENRICH_MAX_PER_RUN
        monkeypatch.setattr(ingestion.settings, "OLLAMA_ENRICH_MAX_PER_RUN", 0)
        assert crawler._enrichment_request_cap() == 0

    def test_under_anthropic_the_cap_is_still_the_dollar_budget(self, monkeypatch):
        from app.modules.job_market import crawler, ingestion

        monkeypatch.setattr(ingestion, "llm_client", ClaudeClient())
        assert crawler._enrichment_request_cap() > ingestion.settings.OLLAMA_ENRICH_MAX_PER_RUN


# --- a reply cut off at the output cap -------------------------------------------


def cut_off(content: str = '{"title": "Engineer", "skills": ["Py') -> dict:
    return {**chat_reply(content), "done_reason": "length"}


class TestTruncation:
    def test_a_cut_off_structured_reply_is_never_re_asked(self, caplog):
        client, seen = make_client(lambda r: httpx.Response(200, json=cut_off()))
        with caplog.at_level(logging.WARNING), pytest.raises(LLMProviderError) as err:
            client.complete_tool_json("s", "u", "extract", SCHEMA, max_tokens=50)
        assert err.value.kind == "truncated" and len(seen) == 1
        assert "output cap (50 tokens)" in str(err.value) and "not re-asked" in caplog.text

    def test_even_a_cut_off_reply_that_happens_to_parse_is_rejected(self):
        whole = json.dumps({"title": "x", "skills": []})
        client, seen = make_client(lambda r: httpx.Response(200, json=cut_off(whole)))
        with pytest.raises(LLMProviderError) as err:
            client.complete_tool_json("s", "u", "extract", SCHEMA)
        assert err.value.kind == "truncated" and len(seen) == 1

    def test_malformed_json_that_was_not_cut_off_is_still_re_asked(self):
        replies = iter([chat_reply("{not json"), {**chat_reply(json.dumps({"title": "x", "skills": []})), "done_reason": "stop"}])
        client, seen = make_client(lambda r: httpx.Response(200, json=next(replies)))
        assert client.complete_tool_json("s", "u", "extract", SCHEMA) == {"title": "x", "skills": []}
        assert len(seen) == 2

    def test_a_re_ask_that_comes_back_cut_off_stops_there(self):
        replies = iter([chat_reply("{not json"), cut_off()])
        client, seen = make_client(lambda r: httpx.Response(200, json=next(replies)))
        with pytest.raises(LLMProviderError) as err:
            client.complete_tool_json("s", "u", "extract", SCHEMA)
        assert err.value.kind == "truncated" and len(seen) == 2

    def test_complete_json_reports_a_cut_off_reply(self):
        client, seen = make_client(lambda r: httpx.Response(200, json=cut_off('{"a": ')))
        with pytest.raises(LLMProviderError) as err:
            client.complete_json("s", "u")
        assert err.value.kind == "truncated" and len(seen) == 1

    @pytest.mark.asyncio
    async def test_a_cut_off_stream_keeps_its_text_and_says_so_in_the_log(self, caplog):
        payload = (
            json.dumps({"message": {"content": "Hel"}, "done": False}) + "\n"
            + json.dumps({"message": {"content": ""}, "done": True, "done_reason": "length"}) + "\n"
        ).encode()
        client, _ = make_client(lambda r: httpx.Response(200, content=payload))
        with caplog.at_level(logging.WARNING):
            pieces = [t async for t in client.stream_message("s", [{"role": "user", "content": "x"}])]
        assert pieces == ["Hel"] and "hit the output cap" in caplog.text

    def test_the_api_says_the_answer_was_cut_off(self):
        import asyncio
        from types import SimpleNamespace

        from app.main import llm_provider_error_handler

        request = SimpleNamespace(method="POST", url=SimpleNamespace(path="/api/jd/analyze"))
        response = asyncio.run(llm_provider_error_handler(request, LLMProviderError("x", "truncated")))
        assert response.status_code == 503 and b"cut off" in response.body


# --- interactive and background timeouts ---------------------------------------


class TestTimeouts:
    def _client(self, seen):
        def handler(request):
            seen.append(request.extensions["timeout"]["read"])
            return httpx.Response(200, json=chat_reply(json.dumps({"title": "x", "skills": []})))

        return OllamaClient(base_url="http://ollama.test", model="llama3.1", fallback_model="",
                            transport=httpx.MockTransport(handler))

    def test_requests_are_interactive_by_default(self, monkeypatch):
        monkeypatch.setattr(llm_module.settings, "OLLAMA_TIMEOUT_INTERACTIVE_SECONDS", 150.0)
        seen = []
        self._client(seen).complete_tool_json("s", "u", "t", SCHEMA)
        assert seen == [150.0]

    def test_inside_background_they_get_the_background_limit(self, monkeypatch):
        monkeypatch.setattr(llm_module.settings, "OLLAMA_TIMEOUT_BACKGROUND_SECONDS", 300.0)
        seen = []
        client = self._client(seen)
        with llm_module.background():
            client.complete_tool_json("s", "u", "t", SCHEMA)
        client.complete_tool_json("s", "u", "t", SCHEMA)
        assert seen == [300.0, llm_module.settings.OLLAMA_TIMEOUT_INTERACTIVE_SECONDS]

    def test_the_worker_marks_its_crawl_as_background(self, monkeypatch):
        from app import worker

        flags = []
        monkeypatch.setattr(worker, "run_crawl", lambda *a, **k: flags.append(llm_module._BACKGROUND.get()) or (_ for _ in ()).throw(RuntimeError("stop")))
        worker._run_once()
        assert flags == [True]
