r"""LaTeX rendering for the cover letter.

Deliberately not a template file with token substitution like the resume: a
cover letter is a header and one block of body text, so a template would be
almost entirely tokens. Every interpolated value still goes through
escape_latex — a company called "AT&T", or a resume containing a %, otherwise
takes the compile down and surfaces as a LaTeX log rather than anything a user
can act on.

Every string holding LaTeX is a raw string. Without the r prefix Python reads
\b as a backspace and \s, \e, \h as invalid escapes, so `\begin{center}`
reaches tectonic as a control character followed by "egin{center}" and the
document fails to compile.
"""

from app.modules.resume_builder.latex import escape_latex, sanitize_url

# Matches the resume's preamble so a candidate's two documents look like a
# set: same class, same font family, same engine.
_PREAMBLE = r"""\documentclass[letterpaper,11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{hyperref}
\usepackage{parskip}

\pagestyle{empty}
\raggedright
\urlstyle{same}

\begin{document}
"""


def render_cover_letter_tex(
    candidate_name: str,
    contact_line: str,
    company: str,
    job_title: str,
    paragraphs: list[str],
) -> str:
    """A one-page letter: header, subject line, body, sign-off.

    The salutation is "Dear Hiring Team" rather than a name, because we do not
    have one. Guessing "Dear Mr. Smith" from a company name would put a
    fabrication on the most visible line of the document.
    """
    body = "\n\n".join(escape_latex(p) for p in paragraphs if p and p.strip())
    name = escape_latex(candidate_name)

    return "".join([
        _PREAMBLE,
        "\n",
        r"\begin{center}", "\n",
        rf"    {{\Large \textbf{{{name}}}}} \ \vspace{{2pt}}", "\n",
        rf"    \small {contact_line}", "\n",
        r"\end{center}", "\n\n",
        r"\vspace{1em}", "\n\n",
        rf"\textbf{{Re: {escape_latex(job_title)} --- {escape_latex(company)}}}", "\n\n",
        r"\vspace{0.5em}", "\n\n",
        "Dear Hiring Team,\n\n",
        body,
        "\n\n",
        r"\vspace{1em}", "\n\n",
        r"Sincerely, \\", "\n",
        name, "\n\n",
        r"\end{document}", "\n",
    ])


def contact_line(email: str, phone: str = "", linkedin: str = "") -> str:
    """Header contact line, omitting what is missing rather than leaving
    separators around an empty slot."""
    parts = [escape_latex(email) if email else None, escape_latex(phone) if phone else None]
    if url := sanitize_url(linkedin):
        parts.append(rf"\href{{{url}}}{{{escape_latex(linkedin)}}}")
    return r" $\cdot$ ".join(p for p in parts if p)
