"""A general vocabulary of engineering and data-science concepts.

Used by the JD analyzer's rules merge (modules/jd_analyzer/rules.py) to find
concept skills a model left out: "distributed systems", "unit testing",
"threat modeling". Product names are not here (core/taxonomy.py and the keyword
rules cover those); this is practices, methods and fields.

SOURCE. Written by hand from general domain knowledge, organised by widely used
knowledge-area lists rather than by any job description:

  * software engineering: the SWEBOK knowledge areas (design, construction,
    testing, maintenance, configuration management, quality);
  * computer science fundamentals: the ACM/IEEE CS2013 knowledge areas
    (algorithms, systems, networking, parallel and distributed computing);
  * operations: common DevOps / site-reliability practice names;
  * data: data-engineering and database design topics;
  * security: common application- and cloud-security practice names (OWASP,
    NIST-style vocabulary);
  * data science and ML: standard statistics, machine-learning, deep-learning
    and MLOps course topics.

It was NOT built from the JD analyzer's golden or holdout files. It was,
however, written after those files had been read, so terms specific to them
that are not general vocabulary ("database internals", "cs fundamentals",
"cloud data warehouse") were deliberately left out. Because the remaining terms
are common, some of them do occur in those files; the evaluation report states
how many.

Entries are lower case and singular where a plural is just the plural (matching
accepts a trailing "s"). Single words are included only when they are technical
in nearly every context ("indexing", "sharding"), never everyday words that
also name a concept ("transactions", "testing", "security", "design").
"""

CONCEPTS: tuple[str, ...] = (
    # ── software design and construction ──
    "software design", "system design", "software architecture", "object-oriented programming",
    "object-oriented design", "functional programming", "design pattern", "microservice",
    "microservices architecture", "service-oriented architecture", "event-driven architecture",
    "domain-driven design", "api design", "rest api design", "api development", "clean code",
    "refactoring", "code review", "pair programming", "technical debt", "version control",
    "dependency management", "concurrency", "multithreading", "asynchronous programming",
    "memory management", "data structure", "algorithm", "complexity analysis", "debugging",
    "profiling", "performance optimization", "performance tuning", "scalability", "high availability",
    "fault tolerance", "idempotency", "distributed system", "distributed computing",
    "consensus algorithm", "message queue", "message queuing", "event streaming", "stream processing",
    "batch processing", "caching", "load balancing", "rate limiting", "service discovery",
    "serialization", "operating system", "networking fundamentals", "shell scripting",
    # ── testing and quality ──
    "unit testing", "integration testing", "end-to-end testing", "test automation",
    "test-driven development", "behavior-driven development", "regression testing", "load testing",
    "performance testing", "quality assurance", "static analysis", "dynamic analysis", "code coverage",
    "contract testing",
    # ── delivery, operations and cloud ──
    "continuous integration", "continuous delivery", "continuous deployment", "ci/cd",
    "infrastructure as code", "configuration management", "containerization", "container orchestration",
    "virtualization", "cloud computing", "cloud architecture", "cloud infrastructure", "serverless",
    "observability", "monitoring and alerting", "distributed tracing", "log aggregation",
    "incident management", "incident response", "on-call", "site reliability engineering",
    "capacity planning", "disaster recovery", "release management", "deployment automation",
    "blue-green deployment", "canary release", "chaos engineering", "autoscaling", "cost optimization",
    "devops",
    # ── data engineering and databases ──
    "relational database", "database design", "data modeling", "schema design", "query optimization",
    "indexing", "database indexing", "sharding", "partitioning", "replication", "database transaction",
    "acid compliance", "data warehousing", "data warehouse",
    "data lake", "etl", "elt", "data pipeline", "data integration", "data quality", "data governance",
    "data lineage", "change data capture", "dimensional modeling", "big data", "data engineering",
    "database migration", "schema migration",
    # ── security ──
    "application security", "network security", "cloud security", "information security",
    "threat modeling", "vulnerability management", "vulnerability assessment", "penetration testing",
    "security code review", "secure coding", "secure sdlc", "identity and access management",
    "access control", "access control design", "role-based access control", "authentication",
    "authorization", "single sign-on", "encryption", "key management", "secrets management",
    "public key infrastructure", "security monitoring", "risk assessment", "zero trust",
    "security engineering", "bug bounty", "compliance framework",
    # ── statistics and data science ──
    "statistics", "statistical analysis", "statistical modeling", "hypothesis testing", "a/b testing",
    "experimentation", "experiment design", "causal inference", "regression analysis",
    "linear regression", "logistic regression", "time series analysis", "time series forecasting",
    "bayesian statistics", "probability", "data analysis", "exploratory data analysis",
    "data visualization", "feature engineering", "predictive modeling", "predictive model",
    "confidence interval", "survival analysis", "dimensionality reduction", "clustering",
    "anomaly detection", "recommendation system", "data science",
    # ── machine learning and AI ──
    "machine learning", "deep learning", "supervised learning", "unsupervised learning",
    "reinforcement learning", "neural network", "convolutional neural network",
    "recurrent neural network", "natural language processing", "computer vision",
    "large language model", "prompt engineering", "fine-tuning", "transfer learning", "model training",
    "model evaluation", "model deployment", "model serving", "model monitoring", "drift detection",
    "data drift", "mlops", "feature store", "hyperparameter tuning", "distributed training",
    "embedding model", "vector search", "semantic search", "retrieval-augmented generation",
    "information retrieval", "text classification", "named entity recognition", "speech recognition",
    "generative ai",
    # ── web, mobile and process ──
    "frontend development", "backend development", "full-stack development", "responsive design",
    "web accessibility", "web performance", "state management", "mobile development", "agile",
    "scrum", "kanban",
)
