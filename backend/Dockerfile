# Python 3.12 is a hard floor, not a preference — numpy==2.5.1 (requirements.txt)
# requires it, since the trained ATS model is pickled under numpy's 2.x major
# and loading it under 1.x is not guaranteed. Do not downgrade this image to
# satisfy an installer error; see requirements.txt's own comment on numpy.
FROM python:3.12-slim

# libpq5: psycopg2-binary's runtime dependency on Debian.
# ca-certificates: TLS for both pip and install_tectonic.py's download below.
# libgraphite2-3: tectonic (the LaTeX engine behind resume/cover-letter PDF
# generation) dynamically links it and fails at runtime, not at install, if
# it's missing — `python scripts/install_tectonic.py` below only extracts
# the binary, it doesn't verify it actually runs on this base image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 ca-certificates libgraphite2-3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies before the rest of the source so a code-only change doesn't
# invalidate this layer on every rebuild.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Fetches the pinned tectonic binary into .tools/ at build time (see
# scripts/install_tectonic.py's own docstring) — resume/cover-letter PDF
# generation needs it, and baking it into the image means the running
# container never needs outbound network access to compile one.
RUN python scripts/install_tectonic.py

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# ENVIRONMENT, DB_URL, and every secret are supplied at deploy time (see
# .env.example) — never baked in here. app/core/config.py's validate_startup()
# refuses to boot with ENVIRONMENT=production if any required one is missing,
# rather than silently falling back to a development default.
#
# UVICORN_WORKERS is a real capacity decision, not a Docker concern — set it
# per deployment. Running more than one worker requires REDIS_URL for correct
# cross-worker realtime delivery and job-market locking; see README.md.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS:-1}"]
