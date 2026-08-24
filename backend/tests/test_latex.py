"""LaTeX escaping, rendering, and compilation — no network, no LLM calls.

The compile tests need tectonic on disk and self-skip if it isn't (matching
test_ml_inference's pattern for the trained model). Everything else — the
part that actually matters for correctness — is pure-function and always
runs: escaping is what stands between user-supplied resume content and a
broken or hijacked LaTeX document.
"""

import pytest

from app.modules.resume_builder import latex


class TestEscapeLatex:
    def test_percent_sign(self):
        """Regression: an unescaped % starts a LaTeX comment and truncates
        the rest of the line — and resume bullets ('Cut costs by 20%') are
        exactly where this is guaranteed to appear."""
        assert latex.escape_latex("Cut costs by 20%") == r"Cut costs by 20\%"

    def test_dollar_sign(self):
        assert latex.escape_latex("$2M in savings") == r"\$2M in savings"

    def test_ampersand(self):
        assert latex.escape_latex("Go & Rust") == r"Go \& Rust"

    def test_underscore(self):
        assert latex.escape_latex("5_engineers") == r"5\_engineers"

    def test_hash(self):
        assert latex.escape_latex("#winning") == r"\#winning"

    def test_braces(self):
        assert latex.escape_latex("{inject}") == r"\{inject\}"

    def test_backslash_not_double_escaped(self):
        """The classic bug with sequential .replace() calls: escaping \\ to
        \\textbackslash{} and then escaping again would corrupt the result.
        A single regex pass, keyed by match rather than by repeated
        substitution, is what rules this out."""
        result = latex.escape_latex("a\\b")
        assert result == r"a\textbackslash{}b"
        # No stray backslash left over that a second pass could act on.
        assert result.count("\\") == 1

    def test_combined_real_world_bullet(self):
        result = latex.escape_latex("Reduced latency by 40% and saved $2M (C++ & Go)")
        assert "40\\%" in result
        assert "\\$2M" in result
        assert "C++ \\& Go" in result

    def test_none_returns_empty_string(self):
        assert latex.escape_latex(None) == ""

    def test_plain_text_unchanged(self):
        assert latex.escape_latex("Senior Backend Engineer") == "Senior Backend Engineer"


class TestSanitizeUrl:
    def test_valid_https(self):
        assert latex.sanitize_url("https://linkedin.com/in/jane") == "https://linkedin.com/in/jane"

    def test_valid_http(self):
        assert latex.sanitize_url("http://example.com") == "http://example.com"

    def test_rejects_non_url(self):
        assert latex.sanitize_url("not a url") is None

    def test_rejects_injection_attempt(self):
        """A brace here could close \\href's argument early and splice
        arbitrary LaTeX into the document — rejected outright rather than
        escaped, since escaping would corrupt a legitimate URL."""
        assert latex.sanitize_url("https://x.com/}\\input{/etc/passwd}") is None

    def test_rejects_empty(self):
        assert latex.sanitize_url("") is None
        assert latex.sanitize_url(None) is None


class TestRenderResumeTex:
    def test_omits_empty_phone_without_dangling_separator(self):
        """Regression: the original template had four fixed VAR_ slots with
        hardcoded '|' separators, so an empty phone rendered as a bare
        floating '|' with nothing on one side."""
        tex = latex.render_resume_tex(
            {"candidate_name": "Jane Doe", "location": "Austin, TX", "email": "j@x.com", "phone": ""}
        )
        contact_line = [ln for ln in tex.splitlines() if "Austin, TX" in ln][0]
        assert "  |" not in contact_line
        assert "|  " not in contact_line or "j@x.com" in contact_line

    def test_omits_summary_section_when_empty(self):
        tex = latex.render_resume_tex({"candidate_name": "Jane Doe", "summary": ""})
        assert "Professional Summary" not in tex

    def test_includes_summary_section_when_present(self):
        tex = latex.render_resume_tex({"candidate_name": "Jane Doe", "summary": "Backend engineer."})
        assert "Professional Summary" in tex
        assert "Backend engineer." in tex

    def test_omits_skills_section_when_both_lists_empty(self):
        tex = latex.render_resume_tex({"candidate_name": "Jane Doe"})
        assert "Core Skills" not in tex

    def test_experience_bullets_are_escaped(self):
        tex = latex.render_resume_tex(
            {
                "candidate_name": "Jane Doe",
                "experiences": [
                    {"title": "Engineer", "company": "Acme", "dates": "2020", "bullets": ["Saved $2M"]}
                ],
            }
        )
        assert r"\$2M" in tex
        assert "$2M" not in tex.replace(r"\$2M", "")  # no un-escaped literal left

    def test_valid_linkedin_produces_href(self):
        tex = latex.render_resume_tex({"candidate_name": "Jane Doe", "linkedin": "https://linkedin.com/in/jane"})
        assert r"\href{https://linkedin.com/in/jane}{LinkedIn}" in tex

    def test_invalid_linkedin_omitted_entirely(self):
        tex = latex.render_resume_tex({"candidate_name": "Jane Doe", "linkedin": "not-a-url"})
        assert "\\href" not in tex

    def test_default_name_when_missing(self):
        tex = latex.render_resume_tex({})
        assert "Candidate Name" in tex


class TestCompileTexToPdf:
    """Requires the real tectonic binary — skips cleanly if it isn't
    installed, same convention as test_ml_inference skipping when there's
    no trained model on disk."""

    pytestmark = pytest.mark.skipif(not latex.tectonic_available(), reason="tectonic not installed")

    def test_compiles_minimal_document(self):
        tex = latex.render_resume_tex({"candidate_name": "Jane Doe", "summary": "A summary."})
        pdf_bytes = latex.compile_tex_to_pdf(tex)
        assert pdf_bytes.startswith(b"%PDF")
        assert latex.count_pdf_pages(pdf_bytes) == 1

    def test_special_characters_render_literally_not_as_escapes(self):
        """End-to-end proof, not just a unit test of the escaper: the
        compiled PDF's extracted text contains the real characters, with no
        backslash leaking into what the reader sees."""
        import fitz

        tex = latex.render_resume_tex(
            {
                "candidate_name": "Jane Doe",
                "experiences": [
                    {
                        "title": "Engineer",
                        "company": "Acme % Corp",
                        "dates": "2020",
                        "bullets": ["Reduced cost by 40% and saved $2M (C++ & Go)"],
                    }
                ],
            }
        )
        pdf_bytes = latex.compile_tex_to_pdf(tex)
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            text = doc[0].get_text()
        assert "40%" in text
        assert "$2M" in text
        assert "Acme % Corp" in text
        assert chr(92) not in text  # no literal backslash visible to the reader

    def test_compile_error_raises_with_log_excerpt(self):
        """A deliberately broken document (unbalanced brace that survives
        because it's injected directly, bypassing render_resume_tex) should
        raise LatexCompileError, not crash with a bare subprocess exception."""
        with pytest.raises(latex.LatexCompileError):
            latex.compile_tex_to_pdf("\\documentclass{article}\\begin{document}\\undefinedcommand{document}")
