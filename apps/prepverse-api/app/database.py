from collections.abc import Generator
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import settings


class Base(DeclarativeBase):
    pass


database_url = settings.database_url
if database_url.startswith("postgres://"):
    database_url = "postgresql+psycopg://" + database_url[len("postgres://"):]
elif database_url.startswith("postgresql://"):
    database_url = "postgresql+psycopg://" + database_url[len("postgresql://"):]

on_vercel = bool(os.environ.get("VERCEL"))
if on_vercel and not database_url.startswith("postgresql+psycopg://"):
    raise RuntimeError("Set PREPVERSE_DATABASE_URL to a persistent PostgreSQL connection before deploying the API to Vercel.")

engine_options = {"pool_pre_ping": True}
if on_vercel:
    # Supavisor transaction-pooler connections should not be held by a serverless process.
    engine_options["poolclass"] = NullPool
    engine_options["connect_args"] = {"prepare_threshold": None}

engine = create_engine(database_url, **engine_options)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
