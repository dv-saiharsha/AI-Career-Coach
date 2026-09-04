"""LaTeX escaping, template rendering, and PDF compilation for the resume builder.

Everything that touches the .tex wire format lives here, same convention as
apify_jobs.py for the job feed: one file owns a format so the rest of
the module deals in plain Python values.

Security note: every string in a compiled resume — name, bullets, company
names — is user-supplied. LaTeX has active characters (%, $, &, #, _, {, },
~, ^, \\) that are common in ordinary resume content ("Cut costs by 20%",
"Built with C++ & Go", "$2M in savings") and, left unescaped, either break
the compile (a bare % starts a comment and truncates the rest of the line)
or — worse — let injected LaTeX commands run. escape_latex() is therefore
applied to every field before it reaches the template; nothing is
interpolated raw except the already-escaped or explicitly-validated pieces
(the LinkedIn URL).
"""

import logging
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

TEMPLATE_PATH = Path(__file__).resolve().parent / "templates" / "one_page_ats.tex"
_LOCAL_TOOLS_DIR = Path(__file__).resolve().parents[3] / ".tools"

# Real LaTeX compiles can hang — a malformed input occasionally drops into an
# interactive "please type a command to continue" prompt rather than failing
# outright. -halt-on-error/-interaction=nonstopmode covers most of that; the
# timeout is the backstop for whatever isn't covered. The first invocation on
# a clean machine may also download tectonic's package cache, so allow that
# one-time setup without weakening the protection against a genuine hang.
COMPILE_TIMEOUT_SECS = 120
MAX_ONE_PAGE_HINT_PAGES = 1


class LatexToolchainMissing(RuntimeError):
    """No tectonic binary found on PATH or in backend/.tools/.

    Raised instead of letting subprocess.run surface a bare FileNotFoundError,
    so the router can return a clean, actionable message rather than a stack
    trace naming an internal path.
    """


class LatexCompileError(RuntimeError):
    """tectonic ran but the document failed to compile.

    Carries a trimmed excerpt of tectonic's own log — genuinely useful for
    diagnosing which field broke the document — rather than the raw
    subprocess exception, which would include the full command line and
    tempdir path.
    """


# ── Escaping ────────────────────────────────────────────────────────────────

# Order-independent by construction: a single regex pass replaces each
# special character exactly once, so a replacement that itself contains a
# backslash (e.g. \textbackslash{}) is never re-escaped on a second pass —
# the classic bug with sequential .replace() calls.
_LATEX_SPECIAL_CHARS = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}
_LATEX_ESCAPE_RE = re.compile("|".join(re.escape(c) for c in _LATEX_SPECIAL_CHARS))


def escape_latex(text: str | None) -> str:
    """Escape every LaTeX-special character in a plain-text string.

    Apply this to every user-supplied field before it reaches the template.
    Do not apply it to a URL destined for \\href's first argument — see
    sanitize_url below.
    """
    return _LATEX_ESCAPE_RE.sub(lambda m: _LATEX_SPECIAL_CHARS[m.group()], text or "")


_SAFE_URL_RE = re.compile(r"^https?://[^\s{}\\]+$")


def sanitize_url(url: str | None) -> str | None:
    """Validate a URL for use inside \\href{...}. Returns None to signal
    "omit this field" rather than guess-repair something that isn't a URL.

    escape_latex() is deliberately NOT applied here: \\href's URL argument
    is parsed by hyperref's own catcode machinery, and running the general
    text escaper over it would corrupt the URL (e.g. turning a literal '&'
    query-string separator into '\\&', which is wrong inside \\href even
    though it's right in visible text). Rejecting anything containing a
    brace or backslash closes the injection path without needing to
    reimplement hyperref's own escaping rules.
    """
    candidate = (url or "").strip()
    if not candidate or not _SAFE_URL_RE.match(candidate):
        return None
    return candidate


_SAFE_EMAIL_RE = re.compile(r"^[^\s{}\\<>]+@[^\s{}\\<>]+\.[^\s{}\\<>]+$")


def sanitize_email(email: str | None) -> str | None:
    """Validate an email for use inside \\href{mailto:...}.

    Same reasoning as sanitize_url, for the same reason: the contact line
    puts the address in two places — the mailto: target and the visible
    text — and those are not the same job. escape_latex() is right for the
    visible text and wrong for the URL argument, which hyperref parses with
    its own catcode rules; running the general escaper over "jane_doe@x.com"
    would turn it into a literal "jane\\_doe@x.com" mailto target, and the
    link would not resolve. So the two are built from the raw address
    (validated here, never escaped) and the escaped address (for display)
    separately, rather than escaping once and reusing the result for both.
    """
    candidate = (email or "").strip()
    if not candidate or not _SAFE_EMAIL_RE.match(candidate):
        return None
    return candidate


# ── Template rendering ──────────────────────────────────────────────────────


def _render_contact_line(location: str, email: str, phone: str, linkedin_url: str | None) -> str:
    """Join only the fields that are actually present.

    The naive approach — four fixed VAR_ slots with hardcoded '|' separators
    between them — renders a bare '|  |' when a field is empty. Building the
    list first and joining it avoids that regardless of which fields are set.

    Icons come from fontawesome5, and only the three macros actually
    confirmed against this project's tectonic install are used —
    \\faLinkedin, \\faMapMarker, \\faGithub, \\faPhone and \\faEnvelope. The
    package ships several near-identical names per icon (faLinkedin vs.
    faLinkedinSquare, faMapMarker vs. faMapMarkerAlt vs. the newer
    faLocationDot), and only some of them exist in the icon font tectonic
    actually resolves here — the rest fail with "Undefined control
    sequence" and would take the whole resume compile down with them. Do
    not swap these for a name that merely looks more "correct"; probe it
    the way this one was probed before using it.
    """
    parts: list[str] = []
    if phone.strip():
        parts.append(f"\\faPhone\\ {escape_latex(phone)}")
    mail_target = sanitize_email(email)
    if mail_target:
        # Raw (validated, unescaped) in the mailto: target; escaped for the
        # visible text next to it — see sanitize_email's docstring for why
        # those cannot be the same string.
        parts.append(f"\\href{{mailto:{mail_target}}}{{\\faEnvelope\\ {escape_latex(mail_target)}}}")
    elif email.strip():
        # Doesn't pass as a real address (or contains a brace/backslash we
        # will not risk inside \\href) — shown as plain text rather than
        # silently dropped, so the candidate can see what they typed.
        parts.append(f"\\faEnvelope\\ {escape_latex(email)}")
    if location.strip():
        parts.append(f"\\faMapMarker\\ {escape_latex(location)}")
    safe_url = sanitize_url(linkedin_url)
    if safe_url:
        parts.append(f"\\href{{{safe_url}}}{{\\faLinkedin\\ LinkedIn}}")
    return " \\quad ".join(parts)


def _render_summary_section(summary: str) -> str:
    if not summary.strip():
        return ""
    return f"\\section{{Professional Summary}}\n{escape_latex(summary)}\n"


def _render_skills_section(technical_skills: list[str], tools_skills: list[str]) -> str:
    technical = [s for s in technical_skills if s.strip()]
    tools = [s for s in tools_skills if s.strip()]
    if not technical and not tools:
        return ""
    lines = ["\\section{Core Skills}", "\\begin{itemize}[label=]"]
    if technical:
        lines.append(f"    \\item \\textbf{{Technical Skills:}} {escape_latex(', '.join(technical))}")
    if tools:
        lines.append(f"    \\item \\textbf{{Tools \\& Platforms:}} {escape_latex(', '.join(tools))}")
    lines.append("\\end{itemize}")
    return "\n".join(lines) + "\n"


def _render_subheading(bold_left: str, italic_right: str, italic_below: str) -> str:
    """The two-line header used by both Experience and Education entries:

        Bold text                                        Italic right
        Italic text below

    tabularx (an X column plus a right-aligned r column) does the alignment
    rather than \\hfill inside a plain paragraph, because \\hfill's spacing
    inside a run of already-escaped text is exactly the kind of thing that
    silently drifts across LaTeX engines and font metrics — a table column
    keyed to \\textwidth does not.

    All three arguments are LaTeX-ready fragments (already escaped by the
    caller); this only arranges them.
    """
    return (
        "\\begin{tabularx}{\\linewidth}{@{}X r@{}}\n"
        f"    \\textbf{{{bold_left}}} & \\textit{{{italic_right}}} \\\\\n"
        "\\end{tabularx}\\\\[-2pt]\n"
        f"\\textit{{{italic_below}}}\\\\"
    )


def _render_experience_section(experiences: list[dict]) -> str:
    if not experiences:
        return ""
    blocks = ["\\section{Experience}"]
    for exp in experiences:
        title = escape_latex(exp.get("title", ""))
        company = escape_latex(exp.get("company", ""))
        dates = escape_latex(exp.get("dates", ""))
        blocks.append(_render_subheading(title, dates, company))
        bullets = [b for b in exp.get("bullets", []) if b.strip()]
        if bullets:
            blocks.append("\\begin{itemize}")
            for bullet in bullets:
                blocks.append(f"    \\item {escape_latex(bullet)}")
            blocks.append("\\end{itemize}")
        blocks.append("\\vspace{4pt}")
    return "\n".join(blocks) + "\n"


def _render_education_section(education: list[dict]) -> str:
    if not education:
        return ""
    blocks = ["\\section{Education}"]
    for edu in education:
        degree = escape_latex(edu.get("degree", ""))
        institution = escape_latex(edu.get("institution", ""))
        dates = escape_latex(edu.get("dates", ""))
        blocks.append(_render_subheading(degree, dates, institution))
        blocks.append("\\vspace{2pt}")
    return "\n".join(blocks) + "\n"


# Two typographic densities, not two templates.
#
# A two-page resume is not a one-page resume with invented content added; it
# is the same content set to be read rather than squeezed. So the only thing
# that differs here is point size, margins and leading — the words are
# identical either way, which is what makes offering the longer format
# honest rather than padding.
#
# "compact" reproduces the values that were hard-coded in the template, so a
# caller that does not ask for a density gets a byte-identical document.
DENSITIES: dict[str, dict[str, str]] = {
    "compact": {
        "VAR_FONT_SIZE": "10pt",
        "VAR_MARGIN": "0.5in",
        "VAR_SECTION_SPACE": "8pt",
        "VAR_ITEM_SPACE": "2pt",
    },
    "regular": {
        "VAR_FONT_SIZE": "11pt",
        "VAR_MARGIN": "0.75in",
        "VAR_SECTION_SPACE": "12pt",
        "VAR_ITEM_SPACE": "4pt",
    },
}


def render_resume_tex(data: dict, density: str = "compact") -> str:
    """Build the full .tex document from a validated payload dict.

    Every value is escaped or explicitly sanitized before interpolation —
    see the module docstring. Callers should pass data.model_dump() from
    CompileResumeRequestSchema (or an equivalent already-validated dict),
    not raw request JSON.
    """
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    replacements = {
        **DENSITIES.get(density, DENSITIES["compact"]),
        "VAR_CANDIDATE_NAME": escape_latex(data.get("candidate_name") or "Candidate Name"),
        "VAR_CONTACT_LINE": _render_contact_line(
            data.get("location", ""), data.get("email", ""), data.get("phone", ""), data.get("linkedin", "")
        ),
        "VAR_SUMMARY_SECTION": _render_summary_section(data.get("summary", "")),
        "VAR_SKILLS_SECTION": _render_skills_section(
            data.get("technical_skills") or [], data.get("tools_skills") or []
        ),
        "VAR_EXPERIENCE_SECTION": _render_experience_section(data.get("experiences") or []),
        "VAR_EDUCATION_SECTION": _render_education_section(data.get("education") or []),
    }
    for token, value in replacements.items():
        template = template.replace(token, value)
    return template


# ── Compilation ──────────────────────────────────────────────────────────────


def _resolve_tectonic() -> str | None:
    """PATH first (a production image may install tectonic via its OS package
    manager), then the project-local copy fetched by scripts/install_tectonic.py."""
    on_path = shutil.which("tectonic")
    if on_path:
        return on_path
    for name in ("tectonic.exe", "tectonic"):
        local = _LOCAL_TOOLS_DIR / name
        if local.exists():
            return str(local)
    return None


def tectonic_available() -> bool:
    return _resolve_tectonic() is not None


def compile_tex_to_pdf(tex_source: str) -> bytes:
    """Compile a .tex document to PDF bytes.

    Raises LatexToolchainMissing if no tectonic binary can be found, or
    LatexCompileError if tectonic ran but the document didn't compile.
    """
    binary = _resolve_tectonic()
    if not binary:
        raise LatexToolchainMissing(
            "No tectonic binary found on PATH or in backend/.tools/. "
            "Run: python scripts/install_tectonic.py"
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        tex_path = Path(tmpdir) / "resume.tex"
        tex_path.write_text(tex_source, encoding="utf-8")

        try:
            result = subprocess.run(
                [
                    binary,
                    "--outdir",
                    tmpdir,
                    # tectonic has no --shell-escape / \write18 support at
                    # all, so arbitrary-command execution from resume content
                    # isn't reachable through this call even before escaping
                    # is considered. --untrusted is explicit defense-in-depth
                    # on top of that (tectonic's own description: "disable
                    # all known-insecure features") — belt and suspenders on
                    # top of escape_latex(), not a substitute for it.
                    "--untrusted",
                    "--chatter",
                    "minimal",
                    str(tex_path),
                ],
                capture_output=True,
                text=True,
                timeout=COMPILE_TIMEOUT_SECS,
                cwd=tmpdir,
            )
        except subprocess.TimeoutExpired as exc:
            raise LatexCompileError(
                f"LaTeX compilation timed out after {COMPILE_TIMEOUT_SECS}s"
            ) from exc

        pdf_path = Path(tmpdir) / "resume.pdf"
        if result.returncode != 0 or not pdf_path.exists():
            # Tail the log rather than dumping it whole — tectonic's output
            # can run to hundreds of lines of package boilerplate before the
            # actual error.
            tail = "\n".join((result.stdout + result.stderr).splitlines()[-25:])
            logger.error("tectonic compile failed (exit %s):\n%s", result.returncode, tail)
            raise LatexCompileError(f"LaTeX compilation failed: {tail}")

        return pdf_path.read_bytes()


def count_pdf_pages(pdf_bytes: bytes) -> int:
    """Page count of a compiled PDF — used to warn when content overflowed
    the intended one-page layout rather than silently returning a longer
    document. Reuses PyMuPDF, already a dependency via resume_analyzer/report.py."""
    import fitz

    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        return doc.page_count
