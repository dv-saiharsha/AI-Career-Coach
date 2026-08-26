from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.core.config import settings

connect_args = {"check_same_thread": False} if settings.DB_URL.startswith("sqlite") else {}
# Pool sizing is a concurrency ceiling, not a tuning nicety: the defaults
# (pool_size=5, max_overflow=10) cap the whole process at 15 simultaneous
# database operations, and every request over that blocks waiting for a
# connection.
#
# pool_pre_ping because pgbouncer closes idle server-side connections; without
# it the first request after a quiet period fails on a dead socket rather than
# transparently reconnecting. Under transaction pooling that matters more, not
# less — connections are recycled constantly.
#
# SQLite (the local dev default) has no connection pool to size — passing
# these to it raises, so they are applied only to real database URLs.
_pool_kwargs = (
    {}
    if settings.DB_URL.startswith("sqlite")
    else {
        "pool_size": settings.DB_POOL_SIZE,
        "max_overflow": settings.DB_MAX_OVERFLOW,
        "pool_pre_ping": True,
        "pool_recycle": settings.DB_POOL_RECYCLE_SECONDS,
    }
)

engine = create_engine(settings.DB_URL, connect_args=connect_args, **_pool_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
