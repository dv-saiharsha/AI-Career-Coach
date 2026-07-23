"""
Version-controlled seed job descriptions for the ATS training-data bootstrap
(see generate_training_data.py). These are hand-authored, not LLM-generated —
no API cost. Cross-paired against user-provided resumes to build the labeled
dataset: an in-role pairing (Data Scientist resume x Data Scientist JD) tests
quality signal, a cross-role pairing (Security Engineer resume x Data
Scientist JD) tests relevance signal, for free, with no extra resumes needed.

Each entry: id, role (must match a data/raw/resumes/<role> folder name),
seniority, and the JD text itself.
"""

SEED_JOB_DESCRIPTIONS = [
    # --- Data Scientist ---
    {
        "id": "data-scientist-junior",
        "role": "data-scientist",
        "seniority": "junior",
        "text": (
            "Junior Data Scientist — early-stage fintech startup. You'll help build our first "
            "credit-risk scoring models under guidance from a senior data scientist. Requirements: "
            "1-2 years experience with Python, pandas, scikit-learn. Comfortable writing SQL queries "
            "against a Postgres warehouse. Exposure to A/B testing and basic statistics (hypothesis "
            "testing, confidence intervals). Nice to have: experience with a BI tool (Looker, Metabase), "
            "familiarity with Jupyter notebooks and matplotlib/seaborn for exploratory analysis. You'll "
            "work closely with product and engineering to turn ad-hoc analysis into repeatable pipelines."
        ),
    },
    {
        "id": "data-scientist-senior",
        "role": "data-scientist",
        "seniority": "senior",
        "text": (
            "Senior Data Scientist — enterprise healthcare analytics. 6+ years of experience building "
            "and deploying predictive models in production (not just notebooks). Deep expertise in "
            "Python, scikit-learn, and either XGBoost or LightGBM. Strong SQL and experience with a "
            "cloud data warehouse (Snowflake, BigQuery, or Redshift). Track record of model monitoring "
            "and drift detection in production. Experience mentoring junior data scientists and "
            "presenting findings to non-technical stakeholders. Familiarity with HIPAA-adjacent data "
            "handling is a plus. You'll own the full lifecycle from problem framing to production "
            "deployment on AWS SageMaker."
        ),
    },
    {
        "id": "data-scientist-mid",
        "role": "data-scientist",
        "seniority": "mid",
        "text": (
            "Data Scientist — remote-first marketplace company. 3-5 years of experience. Strong Python "
            "and pandas skills; comfortable with statistical modeling (regression, time series) and "
            "experimentation design. Experience with dbt or a similar transformation layer is a plus. "
            "You'll partner with growth and marketing teams to build churn and LTV models, and present "
            "results in a clear, actionable way. Git and code review experience expected — this isn't a "
            "notebook-only role, our models ship to production APIs."
        ),
    },
    # --- ML Engineer ---
    {
        "id": "ml-engineer-junior",
        "role": "ml-engineer",
        "seniority": "junior",
        "text": (
            "Junior ML Engineer — computer vision team at a logistics startup. 1-2 years experience "
            "with PyTorch or TensorFlow. Understanding of CNN architectures and basic training loops. "
            "Comfortable with Docker for packaging models. Python fundamentals should be strong — "
            "type hints, testing with pytest, clean function design. Exposure to a cloud provider (AWS, "
            "GCP, or Azure) for training jobs. You'll work on data pipelines for our package-detection "
            "model under senior engineer guidance."
        ),
    },
    {
        "id": "ml-engineer-senior",
        "role": "ml-engineer",
        "seniority": "senior",
        "text": (
            "Senior ML Engineer — recommendation systems at scale (100M+ users). 6+ years shipping ML "
            "models to production. Deep PyTorch expertise, experience with distributed training "
            "(DDP, multi-GPU), and MLOps tooling (MLflow, Kubeflow, or similar). Strong systems "
            "background — you should be comfortable reasoning about latency, throughput, and serving "
            "infrastructure (Triton, TorchServe, or a custom serving layer). Experience with feature "
            "stores and online/offline training-serving skew is essential. You'll lead architecture "
            "decisions for our next-gen recommendation pipeline."
        ),
    },
    {
        "id": "ml-engineer-mid",
        "role": "ml-engineer",
        "seniority": "mid",
        "text": (
            "ML Engineer — NLP team at a customer-support SaaS company. 3-5 years of experience with "
            "PyTorch and the Hugging Face ecosystem (transformers, tokenizers). Experience fine-tuning "
            "pretrained language models for classification or extraction tasks. Solid Python engineering "
            "practices — CI/CD familiarity, unit testing, code review. You'll build and maintain the "
            "ticket-classification model that routes support tickets to the right team."
        ),
    },
    # --- AI Engineer ---
    {
        "id": "ai-engineer-junior",
        "role": "ai-engineer",
        "seniority": "junior",
        "text": (
            "Junior AI Engineer — building LLM-powered features for a productivity app. 1-2 years "
            "experience integrating with an LLM API (OpenAI, Anthropic, or similar). Comfortable with "
            "prompt engineering fundamentals and basic evaluation of model outputs. Python and REST API "
            "experience required. Exposure to vector databases (Pinecone, Weaviate, or pgvector) for "
            "retrieval-augmented generation is a plus. You'll help build and test prompts for our "
            "AI writing assistant feature."
        ),
    },
    {
        "id": "ai-engineer-senior",
        "role": "ai-engineer",
        "seniority": "senior",
        "text": (
            "Senior AI Engineer — agentic systems team. 5+ years of software engineering experience, "
            "including 2+ years building production LLM applications. Deep understanding of tool-use "
            "patterns, structured outputs, and prompt caching for cost control. Experience designing "
            "multi-step agent workflows and evaluating them rigorously (not just vibes-based testing). "
            "Strong Python and API design skills. Experience with the Anthropic or OpenAI API at scale, "
            "including rate limiting, retries, and cost monitoring. You'll own the architecture for our "
            "autonomous research-agent product."
        ),
    },
    {
        "id": "ai-engineer-mid",
        "role": "ai-engineer",
        "seniority": "mid",
        "text": (
            "AI Engineer — applied AI team at an HR-tech company. 3-4 years of experience, with at least "
            "1 year working directly with LLM APIs in production. Experience with retrieval-augmented "
            "generation (RAG) pipelines — chunking strategy, embedding models, vector search. Strong "
            "Python skills and comfort with FastAPI or a similar framework. You'll build the resume "
            "screening and job-matching features that sit at the core of our product."
        ),
    },
    # --- Backend Engineer ---
    {
        "id": "backend-engineer-junior",
        "role": "backend-engineer",
        "seniority": "junior",
        "text": (
            "Junior Backend Engineer — early-stage social platform. 1-2 years of experience with a "
            "backend framework (Django, FastAPI, Express, or Rails). Solid understanding of REST API "
            "design and relational databases (PostgreSQL preferred). Familiarity with Git workflows and "
            "code review. Exposure to Docker is a plus but not required — we'll teach you. You'll work "
            "on our core API alongside two senior engineers, shipping features end to end."
        ),
    },
    {
        "id": "backend-engineer-senior",
        "role": "backend-engineer",
        "seniority": "senior",
        "text": (
            "Senior Backend Engineer — payments infrastructure. 6+ years of experience building "
            "high-reliability distributed systems. Deep expertise in at least one of Go, Java, or Python "
            "at production scale. Strong understanding of database internals (indexing, transactions, "
            "replication) and experience with PostgreSQL or MySQL at scale. Experience with message "
            "queues (Kafka, SQS, or RabbitMQ) and idempotent API design for financial transactions. "
            "You'll lead the redesign of our ledger service and mentor two mid-level engineers."
        ),
    },
    {
        "id": "backend-engineer-mid",
        "role": "backend-engineer",
        "seniority": "mid",
        "text": (
            "Backend Engineer — developer tools company. 3-5 years of experience with Python or "
            "TypeScript backend services. Strong REST and/or GraphQL API design skills. Experience with "
            "PostgreSQL, database migrations, and writing integration tests. Comfortable working with "
            "CI/CD pipelines (GitHub Actions or similar) and containerized deployments. You'll build "
            "features for our internal developer platform used by thousands of engineering teams."
        ),
    },
    # --- Security Engineer ---
    {
        "id": "security-engineer-junior",
        "role": "security-engineer",
        "seniority": "junior",
        "text": (
            "Junior Security Engineer — SaaS company handling sensitive customer data. 1-2 years of "
            "experience in application security or a related field. Understanding of the OWASP Top 10 "
            "and common vulnerability classes (SQLi, XSS, CSRF, SSRF). Familiarity with static analysis "
            "tools and basic penetration-testing concepts. Scripting ability in Python or Bash. Security "
            "certifications (Security+, or coursework) are a plus but not required. You'll help triage "
            "vulnerability reports and support security reviews for new features."
        ),
    },
    {
        "id": "security-engineer-senior",
        "role": "security-engineer",
        "seniority": "senior",
        "text": (
            "Senior Security Engineer — leading the AppSec program at a fintech company. 6+ years of "
            "experience in application and infrastructure security. Deep expertise in threat modeling, "
            "secure SDLC practices, and authentication/authorization design (OAuth2, JWT, session "
            "management). Experience running a bug bounty program and coordinating incident response. "
            "Strong scripting/automation skills (Python) for building internal security tooling. "
            "Experience with cloud security (AWS IAM, VPC design, encryption key management). You'll "
            "own the security roadmap and report directly to engineering leadership."
        ),
    },
    {
        "id": "security-engineer-mid",
        "role": "security-engineer",
        "seniority": "mid",
        "text": (
            "Security Engineer — platform team at a healthcare data company. 3-5 years of experience in "
            "application security or security engineering. Solid understanding of encryption at rest "
            "and in transit, secrets management (Vault or similar), and access-control design. "
            "Experience with security code review and working with engineering teams to remediate "
            "findings without becoming a bottleneck. Familiarity with compliance frameworks (SOC 2, "
            "HIPAA) is a strong plus. You'll partner with backend teams to bake security into the "
            "development process."
        ),
    },
    # --- Wildcards (role-agnostic; used to generate cross-role "unrelated" pairs
    # for every resume, regardless of tier or intended role) ---
    {
        "id": "wildcard-senior-generalist",
        "role": "wildcard",
        "seniority": "senior",
        "text": (
            "Senior Software Engineer — generalist, full-stack product team. 6+ years of professional "
            "software engineering experience across the stack. Strong system design skills and a track "
            "record of leading cross-functional projects from design to launch. Excellent written and "
            "verbal communication. Experience mentoring other engineers. We care more about engineering "
            "judgment and ownership than any specific tech stack — you'll pick up what you need."
        ),
    },
    {
        "id": "wildcard-junior-generalist",
        "role": "wildcard",
        "seniority": "junior",
        "text": (
            "Junior Software Engineer — new-grad friendly, generalist rotation program. 0-2 years of "
            "professional experience (internships count). Solid CS fundamentals — data structures, "
            "algorithms, and at least one language you're comfortable building projects in. Eagerness "
            "to learn and strong communication skills matter more than specific framework experience. "
            "You'll rotate across two teams in your first year to find where you fit best."
        ),
    },
]
