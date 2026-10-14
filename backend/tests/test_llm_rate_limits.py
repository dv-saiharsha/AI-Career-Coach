"""Every billed endpoint carries a limit — enforced, not remembered.

WHY THIS FILE EXISTS

Rate limiting was originally written as a statement inside four handlers.
That is invisible from the route definition, so the next eleven endpoints
that reached Claude shipped without one: /cover-letter/generate, whose own
docstring says it "costs one Claude call — roughly $0.017", had no ceiling
at all. An authenticated account could loop it.

Adding limits to those eleven fixes today. It does not fix the mechanism
that lost them, which is that nothing failed when they were missing. This
test is that mechanism: it walks the real route table, works out statically
which handlers can reach the Anthropic client, and fails when one of them
has no RateLimit dependency.

WHY THE REACHABILITY CHECK IS STATIC

The alternative is to call every route with a stubbed client and see which
ones touch it, which needs a valid payload, a fixture and an auth context
for all seventy-odd. Reading the call graph needs none of that and cannot
be defeated by a route that is merely hard to call in a test.

The trace is deliberately conservative in the direction that matters: it
resolves a call by name against every function in the app, so an unrelated
function sharing a name pulls its callee set in. That over-approximates
reachability, which fails loudly (a route is asked for a limit it may not
need) rather than silently (a billed route slips through). If a route is
flagged that genuinely cannot bill, add it to KNOWN_FREE below with the
reason — do not loosen the trace.
"""

import ast
import os

import pytest

from app.core.ratelimit import RateLimit
from app.main import app

APP_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")

# Methods on ClaudeClient that actually issue a billed request.
BILLED_METHODS = {"complete_json", "complete_tool_json", "stream", "stream_text"}

# Routes the trace flags that provably cannot reach Claude, with the reason.
KNOWN_FREE: dict[tuple[str, str], str] = {
    ("GET", "/health/llm"): (
        "reports which provider is configured and, under Ollama, makes one GET /api/tags; "
        "it sends no completion request, so nothing can bill or generate"
    ),
}


# What a KNOWN_FREE handler may touch on the shared client. Both are
# configuration reads or a cheap status probe; neither sends a completion.
SAFE_LLM_MEMBERS = {"health", "provider"}


def _why_not_provably_free(handler: ast.AST) -> str | None:
    """None if `handler` reaches the LLM client only through SAFE_LLM_MEMBERS.

    KNOWN_FREE used to be a bare list the test skipped, which trusted the
    reason written next to each entry. This reads the handler instead: any
    billed method, any other member of the client, and any bare use of the
    client (passing it to a helper, aliasing it) all fail, because from the
    outside those cannot be told apart from a call that bills.
    """
    safe_accesses = 0
    client_names = 0
    for node in ast.walk(handler):
        if isinstance(node, ast.Attribute):
            if node.attr in BILLED_METHODS:
                return f"calls .{node.attr}(), which sends a completion"
            if isinstance(node.value, ast.Name) and node.value.id == "llm_client":
                if node.attr not in SAFE_LLM_MEMBERS:
                    return f"uses llm_client.{node.attr}, which is not one of {sorted(SAFE_LLM_MEMBERS)}"
                safe_accesses += 1
        if isinstance(node, ast.Name):
            if node.id == "ClaudeClient":
                return "constructs or references ClaudeClient directly"
            if node.id == "llm_client":
                client_names += 1
    if client_names != safe_accesses:
        return "uses llm_client other than through its safe members (passed to a helper or aliased)"
    return None


def _module_name(path: str) -> str:
    rel = os.path.relpath(path, os.path.dirname(APP_ROOT))
    name = rel[:-3].replace(os.sep, ".")
    return name[:-9] if name.endswith(".__init__") else name


def _load():
    """{qualified name -> (module, ast node)} and {module -> import aliases}."""
    functions: dict[str, tuple[str, ast.AST]] = {}
    aliases: dict[str, dict[str, str]] = {}
    sources: dict[str, str] = {}

    for dirpath, _, filenames in os.walk(APP_ROOT):
        for filename in filenames:
            if not filename.endswith(".py"):
                continue
            path = os.path.join(dirpath, filename)
            module = _module_name(path)
            source = open(path, encoding="utf-8").read()
            sources[module] = source
            tree = ast.parse(source)
            aliases[module] = {}
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("app"):
                    for alias in node.names:
                        aliases[module][alias.asname or alias.name] = f"{node.module}.{alias.name}"
            for node in tree.body:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    functions[f"{module}.{node.name}"] = (module, node)
                elif isinstance(node, ast.ClassDef):
                    for child in node.body:
                        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            functions[f"{module}.{node.name}.{child.name}"] = (module, child)
    return functions, aliases, sources


FUNCTIONS, ALIASES, SOURCES = _load()


def _bills_directly(node: ast.AST) -> bool:
    for child in ast.walk(node):
        if isinstance(child, ast.Attribute) and child.attr in BILLED_METHODS:
            return True
        if isinstance(child, ast.Name) and child.id in ("llm_client", "ClaudeClient"):
            return True
    return False


def _callees(qualified: str) -> set[str]:
    module, node = FUNCTIONS[qualified]
    found: set[str] = set()
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        func = child.func
        name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
        if not name:
            continue
        if name in ALIASES[module]:
            found.add(ALIASES[module][name])
        found.update(c for c in FUNCTIONS if c.rsplit(".", 1)[-1] == name)

        # run_in_threadpool(fn, ...) calls fn, but passes it as a reference,
        # so fn never appears as a Call and the plain walk above misses it
        # entirely. Moving one billed handler off the event loop was enough
        # to make this trace stop seeing /api/resume/analyze — which the
        # sanity test above caught, and which is the reason it exists.
        if name == "run_in_threadpool" and child.args:
            target = child.args[0]
            referenced = (
                target.id if isinstance(target, ast.Name) else getattr(target, "attr", None)
            )
            if referenced:
                if referenced in ALIASES[module]:
                    found.add(ALIASES[module][referenced])
                found.update(
                    c for c in FUNCTIONS if c.rsplit(".", 1)[-1] == referenced
                )
    return found


_REACHES: dict[str, bool] = {}


def _reaches_claude(qualified: str, stack: frozenset = frozenset()) -> bool:
    if qualified in _REACHES:
        return _REACHES[qualified]
    if qualified not in FUNCTIONS or qualified in stack:
        return False
    _REACHES[qualified] = False  # break recursion before descending
    _, node = FUNCTIONS[qualified]
    result = _bills_directly(node) or any(
        _reaches_claude(callee, stack | {qualified}) for callee in _callees(qualified)
    )
    _REACHES[qualified] = result
    return result


def _billed_routes():
    """(method, path, handler qualified name) for every route reaching Claude."""
    out = []
    for route in app.routes:
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None:
            continue
        qualified = f"{endpoint.__module__}.{endpoint.__name__}"
        if not _reaches_claude(qualified):
            continue
        for method in sorted(getattr(route, "methods", set()) - {"HEAD", "OPTIONS"}):
            out.append((method, route.path, route))
    return out


BILLED = _billed_routes()


def _has_rate_limit(route) -> bool:
    """Walk the resolved dependency tree — a limit declared on a shared
    router dependency counts exactly as much as one on the handler."""
    pending = [route.dependant]
    while pending:
        dependant = pending.pop()
        if isinstance(getattr(dependant, "call", None), RateLimit):
            return True
        pending.extend(dependant.dependencies)
    return False


def test_the_trace_finds_the_endpoints_we_know_are_billed():
    """A guard on the guard.

    If the trace silently stopped resolving calls it would report zero billed
    routes and every assertion below would pass vacuously. These four are
    known to call Claude and must always be in the set.
    """
    paths = {path for _, path, _ in BILLED}
    for known in (
        "/api/cover-letter/generate",
        "/api/resume/analyze",
        "/api/interview/evaluate",
        "/api/resume-builder/tailor-preview",
    ):
        assert known in paths, f"the reachability trace no longer sees {known}"


@pytest.mark.parametrize(
    "method,path,route", BILLED, ids=[f"{m} {p}" for m, p, _ in BILLED]
)
def test_every_billed_route_is_rate_limited(method, path, route):
    """A route that can spend money on the operator's Anthropic account must
    bound how fast one account can spend it."""
    if (method, path) in KNOWN_FREE:
        # Not skipped: a route is allowed to skip the rate limit only if its
        # handler provably cannot bill, so the claim is checked, not trusted.
        handler = FUNCTIONS[f"{route.endpoint.__module__}.{route.endpoint.__name__}"][1]
        problem = _why_not_provably_free(handler)
        assert problem is None, (
            f"{method} {path} is in KNOWN_FREE ({KNOWN_FREE[(method, path)]}) but its handler {problem}. "
            "Give it a RateLimit dependency and remove it from KNOWN_FREE."
        )
        return
    assert _has_rate_limit(route), (
        f"{method} {path} reaches Claude with no RateLimit dependency. "
        "Add Depends(RateLimit(bucket, cap, window, message)) to the handler "
        "signature, or record it in KNOWN_FREE with the reason it cannot bill."
    )


@pytest.mark.parametrize(
    "source,expect_free",
    [
        ("def h():\n    return llm_client.health()", True),
        ("def h():\n    return {'p': llm_client.provider, 'h': llm_client.health()}", True),
        ("def h():\n    return llm_client.complete_json('s', 'u')", False),
        ("def h():\n    return llm_client.complete_tool_json('s', 'u', 't', {})", False),
        ("def h():\n    return llm_client.embed(['x'])", False),
        ("def h():\n    return some_helper(llm_client)", False),
        ("def h():\n    c = llm_client\n    return c.health()", False),
        ("def h():\n    return ClaudeClient().health()", False),
    ],
)
def test_the_known_free_check_accepts_a_status_probe_and_rejects_anything_that_could_bill(source, expect_free):
    """A guard on the KNOWN_FREE guard: it must not wave everything through."""
    handler = ast.parse(source).body[0]
    assert (_why_not_provably_free(handler) is None) is expect_free


def test_every_known_free_route_still_exists_and_is_flagged_by_the_trace():
    """A KNOWN_FREE entry for a route that no longer exists (or no longer trips
    the trace) is dead weight that could quietly excuse a future route."""
    flagged = {(method, path) for method, path, _ in BILLED}
    assert set(KNOWN_FREE) <= flagged
