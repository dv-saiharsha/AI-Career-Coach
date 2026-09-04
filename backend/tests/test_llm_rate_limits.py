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
KNOWN_FREE: dict[tuple[str, str], str] = {}


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
        pytest.skip(KNOWN_FREE[(method, path)])
    assert _has_rate_limit(route), (
        f"{method} {path} reaches Claude with no RateLimit dependency. "
        "Add Depends(RateLimit(bucket, cap, window, message)) to the handler "
        "signature, or record it in KNOWN_FREE with the reason it cannot bill."
    )
