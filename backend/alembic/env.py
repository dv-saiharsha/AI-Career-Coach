import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool

from alembic import context

# Make `app` importable when Alembic is run from the backend/ directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings, warn_if_transaction_pooler  # noqa: E402
from app.core.database import Base  # noqa: E402
from app.models import interview, job, resume  # noqa: E402,F401 — registers models with Base

config = context.config
# %% not %: set_main_option writes into a configparser, which treats a lone
# % as interpolation syntax. A URL-encoded password (%40 for "@", which any
# password containing @ needs) otherwise raises
# "invalid interpolation syntax" before a single migration runs.
config.set_main_option("sqlalchemy.url", settings.DB_URL.replace("%", "%%"))


if config.config_file_name is not None:
    # disable_existing_loggers=False, because the default is True and would
    # silence every logger created by the `app.*` imports above — which are
    # imported before this line runs and would otherwise be switched off by
    # the very call that sets logging up.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# After fileConfig, not before. Alembic's own logging config is what installs
# the handlers, so a warning emitted above this line is written to nothing.
#
# Checked here as well as at app startup because this is where it bites: the
# transaction pooler cannot hold the session state DDL and advisory locks
# need, so a migration against it fails partway through rather than cleanly —
# and `alembic upgrade head` never calls validate_startup.
warn_if_transaction_pooler()

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
