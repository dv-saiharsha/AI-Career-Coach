from app.core.llm import llm_client

MODEL_ANSWER_SYSTEM_PROMPT = (
    "You are an expert interview coach. Given an interview question, you produce a model answer "
    "that would impress an interviewer, PLUS a concrete worked example, PLUS a plain-language "
    "explanation a complete beginner could follow. Avoid unexplained jargon — when you must use a "
    "technical term, define it in simple words. The goal is that someone new to the field finishes "
    "reading and both understands the concept and knows how to answer the question well."
)

MODEL_ANSWER_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "ideal_answer": {
            "type": "string",
            "description": "The answer a strong candidate would give — clear, structured, interview-ready.",
        },
        "example": {
            "type": "string",
            "description": "A concrete, specific worked example that illustrates the ideal answer.",
        },
        "plain_explanation": {
            "type": "string",
            "description": "A beginner-friendly explanation of the underlying concept, no unexplained jargon.",
        },
        "key_points": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3-5 short bullet points an interviewer wants to hear.",
        },
    },
    "required": ["ideal_answer", "example", "plain_explanation", "key_points"],
}


SCREENING_PREP_SYSTEM_PROMPT = (
    "You are an interview coach preparing a candidate for a recruiter screening call. "
    "Given a job description, you produce the questions that screen will actually open with, "
    "and for each one an answer TEMPLATE the candidate fills in with their own real history.\n\n"
    "The single hard rule: never invent the candidate's experience. Do not state a metric, "
    "employer, project, technology, or outcome as though it were theirs. Anywhere the candidate "
    "must supply a fact, emit a square-bracket placeholder describing what belongs there — "
    "[the % you actually improved it by], [the system you built], [how long you used it]. "
    "A template full of honest placeholders is correct; a fluent paragraph asserting achievements "
    "the candidate never mentioned is a failure, because they would have to lie to say it out loud.\n\n"
    "Cover the screen's real shape: the opening 'tell me about yourself', the core technical "
    "requirement from the JD, and at least one question about a requirement the candidate may not "
    "have — where the answer template must demonstrate the bridge method (name the gap plainly, "
    "connect to genuinely adjacent experience, state how you would close it) rather than bluffing."
)

SCREENING_PREP_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "screening_questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "description": "Short label, e.g. 'Elevator pitch', 'Core technical', 'Gap / unfamiliar tech'",
                    },
                    "question": {"type": "string"},
                    "answer_template": {
                        "type": "string",
                        "description": (
                            "The answer scaffold, with [bracketed placeholders] everywhere the "
                            "candidate must insert their own real facts. Never assert an "
                            "achievement, metric, or employer on their behalf."
                        ),
                    },
                    "key_signal": {"type": "string", "description": "What the screener is actually evaluating."},
                    "what_to_avoid": {"type": "string", "description": "The common failure mode for this question."},
                },
                "required": ["type", "question", "answer_template", "key_signal", "what_to_avoid"],
            },
        },
    },
    "required": ["screening_questions"],
}

# Static, and deliberately so: these are general interview principles, not
# claims about the candidate, so there is nothing for a model to tailor and no
# reason to spend a call generating them.
GENERAL_INTERVIEW_TIPS = [
    {
        "title": "The 60-second pitch",
        "rule": (
            "Present, past, future: ~20s on what you do now, ~20s on one achievement you can "
            "back with a real number, ~20s on why this role is the next step. Stop at a minute — "
            "the screener is checking whether you can be concise under mild pressure."
        ),
    },
    {
        "title": "Handling a gap without bluffing",
        "rule": (
            "The bridge method: name the gap plainly, connect it to the nearest thing you have "
            "genuinely done, then say how you'd close it. Screeners routinely probe a claimed "
            "skill one question deeper, so a bluff costs more than the gap did."
        ),
    },
    {
        "title": "STAR, weighted properly",
        "rule": (
            "Situation and Task are setup — keep them to a couple of sentences each. Action is "
            "the answer and deserves roughly half your airtime. Always land on a Result, and if "
            "you have no number, end on what you'd do differently."
        ),
    },
]


def _jd_keywords(jd_text: str, limit: int = 8) -> list[str]:
    """Rough salient-term extraction, used only for the offline fallback."""
    from app.core.keywords import keyword_candidates

    return keyword_candidates(jd_text)[:limit] if jd_text.strip() else []


def _screening_prep_fallback(job_title: str, company: str, jd_text: str) -> list[dict]:
    """Used when the LLM is unavailable.

    Every answer here is a pure scaffold — there is no sentence a candidate
    could read aloud that asserts something about them, because nothing here
    knows anything about them.
    """
    keywords = _jd_keywords(jd_text, limit=3)
    primary = keywords[0] if keywords else "the core technology in the posting"
    gap = keywords[-1] if keywords else "a tool listed in the posting you haven't used"
    where = f" at {company}" if company.strip() else ""

    return [
        {
            "type": "Elevator pitch",
            "question": f"Tell me about yourself and why you're interested in the {job_title} role{where}.",
            "answer_template": (
                "I'm currently [your role] at [where], where I work on [the one or two things most "
                "relevant to this posting]. Recently I [one concrete thing you built or fixed], which "
                "[the measurable result — only if you actually have the number]. I'm interested in this "
                "role because [the specific thing about the posting or company that genuinely drew you], "
                "and I'd bring [the strength of yours that maps most directly to the requirements]."
            ),
            "key_signal": "Can you compress your background to a minute and aim it at this specific posting.",
            "what_to_avoid": "Walking your resume top to bottom, or a pitch that would fit any job.",
        },
        {
            "type": "Core technical",
            "question": f"Walk me through how you've used {primary} in real work, and the tradeoffs you weighed.",
            "answer_template": (
                f"I used {primary} on [the project], where the problem was [the actual constraint you hit]. "
                "I chose [your approach] over [the alternative you considered] because [your reasoning]. "
                "The tradeoff was [what it cost you — complexity, latency, maintenance]. "
                "[If you measured the outcome, give the real figure here; if you didn't, say what improved and how you knew.]"
            ),
            "key_signal": "Real hands-on depth — a decision with a reason and a cost, not a tool name.",
            "what_to_avoid": "Describing what the technology does rather than what you did with it.",
        },
        {
            "type": "Gap / unfamiliar tech",
            "question": f"How much direct experience do you have with {gap}?",
            "answer_template": (
                f"I haven't worked with {gap} directly. What I have done is [the closest genuinely adjacent "
                "thing you've built], which covers [the concepts that actually carry over]. To close the gap "
                "I'd [the specific, concrete way you'd ramp — not 'I learn fast'], and for reference I picked up "
                "[something you genuinely learned on the job] in [the honest timeframe]."
            ),
            "key_signal": "Whether you can say 'I don't know' cleanly and still show a path forward.",
            "what_to_avoid": "Claiming exposure you don't have — the next question probes one level deeper.",
        },
    ]


def generate_screening_prep(
    job_title: str, company: str, jd_text: str, resume_text: str | None = None
) -> dict:
    """Screening-call questions with answer templates tailored to the JD.

    One LLM call, same per-request cost shape as the model-answer endpoint.
    Falls back to a static scaffold rather than failing, matching how
    model_answer already behaves.
    """
    questions: list[dict] = []
    if llm_client.available:
        user_prompt = (
            f"ROLE: {job_title}\n"
            f"COMPANY: {company or 'not specified'}\n\n"
            f"JOB DESCRIPTION:\n{jd_text[:5000]}\n\n"
            + (
                # Grounding on the real resume is what lets placeholders name
                # the candidate's actual projects instead of staying abstract.
                f"CANDIDATE'S RESUME (use only to decide which placeholders to ask for — "
                f"never restate its contents as a finished claim):\n{resume_text[:4000]}\n\n"
                if resume_text
                else ""
            )
            + "Produce 5 screening questions with answer templates. At least one must be a gap "
            "question the candidate likely cannot answer with direct experience."
        )
        try:
            data = llm_client.complete_tool_json(
                SCREENING_PREP_SYSTEM_PROMPT,
                user_prompt,
                "submit_screening_prep",
                SCREENING_PREP_TOOL_SCHEMA,
                max_tokens=3000,
            )
            questions = [
                q for q in (data.get("screening_questions") or []) if q.get("question") and q.get("answer_template")
            ]
        except Exception:
            questions = []  # fall through to the static scaffold

    if not questions:
        questions = _screening_prep_fallback(job_title, company, jd_text)

    for index, question in enumerate(questions):
        question["id"] = f"q{index + 1}"
        question.setdefault("type", "Screening")
        question.setdefault("key_signal", "")
        question.setdefault("what_to_avoid", "")

    return {
        "job_title": job_title,
        "company": company,
        "screening_questions": questions,
        "general_interview_tips": GENERAL_INTERVIEW_TIPS,
    }


def _model_answer_with_llm(question_text: str, question_type: str, role: str, seniority: str) -> dict:
    user_prompt = (
        f"Role: {seniority} {role}\n"
        f"Question ({question_type}): {question_text}\n\n"
        "Give the model answer, a concrete example, a plain-language explanation for a beginner, "
        "and the key points an interviewer wants to hear."
    )
    data = llm_client.complete_tool_json(
        MODEL_ANSWER_SYSTEM_PROMPT, user_prompt, "submit_model_answer", MODEL_ANSWER_TOOL_SCHEMA, max_tokens=2000
    )
    # The model occasionally omits a field despite the schema marking it required;
    # default every field so a partial response is still a valid, useful answer
    # rather than a 500 from response-schema validation.
    data.setdefault("ideal_answer", "")
    data.setdefault("example", "")
    data.setdefault("plain_explanation", "")
    data.setdefault("key_points", [])
    return data


def _model_answer_fallback(question_text: str, question_type: str) -> dict:
    """Used when the LLM is unavailable — honest about being a generic template
    rather than a tailored model answer, so it never pretends to be more than it is."""
    if question_type == "behavioral":
        structure = (
            "Use the STAR structure: describe the Situation, the Task you owned, the Action you took, "
            "and the measurable Result. Keep it to one real story and end on the outcome."
        )
    else:
        structure = (
            "Start with a one-sentence direct answer, then explain the 'why' behind it, then give a "
            "concrete example from real experience, and close with a tradeoff or edge case you'd watch for."
        )
    return {
        "ideal_answer": (
            "A model answer isn't available offline right now (the AI coach needs an API connection). "
            f"General guidance for this {question_type} question: {structure}"
        ),
        "example": (
            "Example shape: \"When I faced X, I decided to do Y because Z, which led to a measurable "
            "result of W.\" Replace X/Y/Z/W with a real situation from your own experience."
        ),
        "plain_explanation": (
            "Interviewers aren't just checking whether you know the answer — they're checking whether "
            "you can explain your thinking clearly and back it with a real example. Structure and a "
            "concrete story matter as much as being technically correct."
        ),
        "key_points": [
            "Answer the question directly first",
            "Explain your reasoning",
            "Give one concrete, real example",
            "Mention a tradeoff or what you'd watch out for",
        ],
    }


def model_answer(question_text: str, question_type: str, role: str, seniority: str) -> dict:
    if llm_client.available:
        try:
            return _model_answer_with_llm(question_text, question_type, role, seniority)
        except Exception:
            pass  # fall through to the generic template
    return _model_answer_fallback(question_text, question_type)
