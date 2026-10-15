"""Which resume Skills row a technology belongs on, and what it is evidence of.

Three small tables, all keyed by taxonomy canonical names (core/taxonomy):

  CATEGORY_OF   technology -> the FAANG-style skills row it is listed under.
  RELATED       a JD's general requirement -> concrete things on a resume that
                ARE that requirement. PostgreSQL is SQL; a candidate who used
                it can truthfully list "SQL". This is what a "strong related
                match" means, and why the JD's wording may be used for it.
  TRANSFERABLE  families of interchangeable tools. MySQL experience transfers
                to a PostgreSQL role, but it is not PostgreSQL, so the JD's
                term must never be written onto the resume on its strength.

Kept deliberately short and unambiguous. A missing entry costs a weaker match
label; a wrong entry puts a claim on a resume, which is the costlier mistake.
"""

import re

from app.core.taxonomy import canonical

CATEGORIES = (
    "Languages",
    "Frameworks & Libraries",
    "Databases",
    "Cloud & DevOps",
    "Data & Streaming",
    "AI/ML",
    "Tools",
    # Practices and concepts ("Distributed Systems", "CI/CD"): ATS keywords a
    # recruiter searches for, but not technologies, so not mixed into a
    # technology row.
    "Concepts",
)

_BY_CATEGORY: dict[str, list[str]] = {
    "Languages": [
        "python", "java", "javascript", "typescript", "go", "golang", "c", "c++", "c#", "rust",
        "kotlin", "swift", "scala", "ruby", "php", "r", "matlab", "sql", "bash", "shell",
        "html", "css", "dart", "perl", "objective c", "verilog", "vhdl", "solidity",
    ],
    "Frameworks & Libraries": [
        "spring", "spring boot", "django", "flask", "fastapi", "node", "express", "react",
        "nextjs", "vue", "angular", "svelte", "rails", ".net", "asp.net", "graphql",
        "rest apis", "grpc", "junit", "pytest", "jest", "selenium", "cypress", "hibernate",
        "redux", "tailwind", "bootstrap", "jquery", "flutter", "react native", "microservices",
    ],
    "Databases": [
        "postgresql", "postgres", "mysql", "sqlite", "sql server", "oracle", "mongodb",
        "dynamodb", "cassandra", "redis", "elasticsearch", "snowflake", "bigquery",
        "redshift", "neo4j", "firebase", "supabase", "nosql", "relational databases",
        "databases", "couchbase", "mariadb",
    ],
    "Cloud & DevOps": [
        "aws", "gcp", "azure", "docker", "kubernetes", "terraform", "ansible", "jenkins",
        "github actions", "gitlab ci", "circleci", "cicd", "linux", "nginx", "helm",
        "cloudformation", "pulumi", "ec2", "s3", "lambda", "ecs", "eks", "gke", "heroku",
        "vercel", "prometheus", "grafana", "datadog", "containerization", "devops",
        "infrastructure as code", "cloud infrastructure", "serverless",
    ],
    "Data & Streaming": [
        "spark", "kafka", "rabbitmq", "kinesis", "pulsar", "flink", "airflow", "dbt", "hadoop",
        "tableau", "power bi", "looker", "etl", "pandas", "numpy", "matplotlib", "jupyter",
    ],
    "AI/ML": [
        "machine learning", "deep learning", "pytorch", "tensorflow", "keras", "scikit-learn",
        "natural language processing", "computer vision", "llm", "mlops", "hugging face",
        "langchain", "opencv", "xgboost",
    ],
    "Concepts": [
        "distributed systems", "event streaming", "microservices", "rest apis", "cicd",
        "automated testing", "unit testing", "data analysis", "data science",
        "object oriented programming", "system design", "data structures", "algorithms",
        "relational databases", "nosql", "infrastructure as code", "containerization",
        "devops", "cloud infrastructure", "serverless", "backend development",
        "frontend development", "observability", "incident response", "agile", "scrum",
    ],
    "Tools": [
        "git", "github", "gitlab", "jira", "confluence", "postman", "figma", "vs code",
        "intellij", "agile", "scrum", "unix", "excel",
    ],
}

CATEGORY_OF: dict[str, str] = {
    canonical(term): category for category, terms in _BY_CATEGORY.items() for term in terms
}

# Every technology this module knows by name. Used to pick real technologies
# out of a JD's keyword candidates when the JD analysis is rules-only.
KNOWN_TECH = frozenset(CATEGORY_OF)

RELATED: dict[str, list[str]] = {
    "sql": ["postgresql", "postgres", "mysql", "sqlite", "sql server", "oracle", "mariadb", "snowflake", "bigquery", "redshift"],
    "relational databases": ["postgresql", "postgres", "mysql", "sqlite", "sql server", "oracle", "mariadb"],
    "databases": ["postgresql", "postgres", "mysql", "sqlite", "mongodb", "dynamodb", "redis", "cassandra", "oracle"],
    "nosql": ["mongodb", "dynamodb", "cassandra", "redis", "couchbase", "firebase"],
    "rest apis": ["restful", "rest api", "fastapi", "flask", "django rest framework", "spring boot", "express"],
    "cicd": ["github actions", "jenkins", "gitlab ci", "circleci", "ci/cd", "continuous integration"],
    "automated testing": ["junit", "pytest", "jest", "selenium", "cypress", "unit test", "integration test", "test automation"],
    "unit testing": ["junit", "pytest", "jest", "unit test"],
    "containerization": ["docker", "podman", "kubernetes"],
    "cloud": ["aws", "gcp", "azure"],
    "cloud infrastructure": ["aws", "gcp", "azure", "ec2", "s3", "lambda"],
    "event streaming": ["kafka", "kinesis", "pulsar", "rabbitmq"],
    "version control": ["git", "github", "gitlab"],
    "machine learning": ["scikit-learn", "pytorch", "tensorflow", "keras", "xgboost"],
    "deep learning": ["pytorch", "tensorflow", "keras"],
    "data analysis": ["pandas", "numpy", "excel", "tableau", "power bi"],
    "frontend development": ["react", "vue", "angular", "svelte", "nextjs"],
    "backend development": ["fastapi", "flask", "django", "spring boot", "express", "node"],
    "object oriented programming": ["java", "c++", "c#", "python", "kotlin"],
}

TRANSFERABLE: list[list[str]] = [
    ["aws", "gcp", "azure"],
    ["postgresql", "mysql", "sql server", "oracle", "mariadb", "sqlite"],
    ["mongodb", "dynamodb", "cassandra", "couchbase"],
    ["java", "c#", "kotlin", "scala"],
    ["python", "ruby", "javascript", "typescript", "go"],
    ["react", "vue", "angular", "svelte"],
    ["spring boot", "django", "fastapi", "flask", "express", "rails", ".net"],
    ["kafka", "rabbitmq", "kinesis", "pulsar"],
    ["kubernetes", "ecs", "nomad", "openshift"],
    ["jenkins", "github actions", "gitlab ci", "circleci"],
    ["pytorch", "tensorflow", "jax"],
    ["junit", "pytest", "jest"],
    ["terraform", "cloudformation", "pulumi"],
    ["tableau", "power bi", "looker"],
    ["airflow", "dagster", "prefect"],
    ["spark", "hadoop", "flink"],
]

_TRANSFERABLE_INDEX: dict[str, list[str]] = {}
for _family in TRANSFERABLE:
    for _member in _family:
        _TRANSFERABLE_INDEX[canonical(_member)] = [canonical(m) for m in _family if m != _member]


def category_of(term: str) -> str | None:
    return CATEGORY_OF.get(canonical(term))


def related_evidence_terms(requirement: str) -> list[str]:
    """Resume terms that ARE this requirement (PostgreSQL for "SQL")."""
    return RELATED.get(canonical(requirement), [])


def transferable_from(requirement: str) -> list[str]:
    """Tools whose experience transfers to this one but is not this one."""
    return _TRANSFERABLE_INDEX.get(canonical(requirement), [])


def category_from_label(label: str) -> str | None:
    """Map a candidate's own row label ("Cloud/Tools") to a standard row."""
    lowered = (label or "").lower()
    for pattern, category in (
        (r"language", "Languages"),
        (r"framework|librar", "Frameworks & Libraries"),
        (r"database", "Databases"),
        (r"cloud|devops|infrastructure", "Cloud & DevOps"),
        (r"machine|\bml\b|\bai\b", "AI/ML"),
        (r"data|stream", "Data & Streaming"),
        (r"tool", "Tools"),
    ):
        if re.search(pattern, lowered):
            return category
    return None
