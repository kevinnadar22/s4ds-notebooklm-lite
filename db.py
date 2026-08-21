"""Minimal SQLite persistence via SQLModel (sessions, messages, documents)."""

from datetime import datetime, timezone
from pathlib import Path

from sqlmodel import Field, Session, SQLModel, create_engine, select

DB_PATH = Path("data") / "app.db"
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})

VALID_MODES = ("conversing", "quiz")


class ChatSession(SQLModel, table=True):
    __tablename__ = "sessions"
    id: int | None = Field(default=None, primary_key=True)
    mode: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Message(SQLModel, table=True):
    __tablename__ = "messages"
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(index=True)
    role: str
    content: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Document(SQLModel, table=True):
    __tablename__ = "documents"
    id: int | None = Field(default=None, primary_key=True)
    filename: str = Field(index=True)
    chunks: int = 0
    bytes: int = 0
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    SQLModel.metadata.create_all(engine)


def create_session(mode: str) -> dict:
    if mode not in VALID_MODES:
        raise ValueError(f"mode must be one of {VALID_MODES}")
    with Session(engine) as s:
        row = ChatSession(mode=mode)
        s.add(row)
        s.commit()
        s.refresh(row)
        return row.model_dump()


def get_session(session_id: int) -> dict | None:
    with Session(engine) as s:
        row = s.get(ChatSession, session_id)
        return row.model_dump() if row else None


def add_message(session_id: int, role: str, content: str) -> dict:
    with Session(engine) as s:
        row = Message(session_id=session_id, role=role, content=content)
        s.add(row)
        s.commit()
        s.refresh(row)
        return row.model_dump()


def list_messages(session_id: int) -> list[dict]:
    with Session(engine) as s:
        rows = s.exec(
            select(Message).where(Message.session_id == session_id).order_by(Message.id)
        ).all()
        return [r.model_dump() for r in rows]


def upsert_document(filename: str, chunks: int, bytes_size: int) -> dict:
    """Create or refresh a document row after ingest."""
    with Session(engine) as s:
        existing = s.exec(select(Document).where(Document.filename == filename)).first()
        if existing:
            existing.chunks = chunks
            existing.bytes = bytes_size
            existing.created_at = datetime.now(timezone.utc).isoformat()
            s.add(existing)
            s.commit()
            s.refresh(existing)
            return existing.model_dump()
        row = Document(filename=filename, chunks=chunks, bytes=bytes_size)
        s.add(row)
        s.commit()
        s.refresh(row)
        return row.model_dump()


def list_documents() -> list[dict]:
    with Session(engine) as s:
        rows = s.exec(select(Document).order_by(Document.id.desc())).all()
        return [r.model_dump() for r in rows]


def get_document(doc_id: int) -> dict | None:
    with Session(engine) as s:
        row = s.get(Document, doc_id)
        return row.model_dump() if row else None


def delete_document(doc_id: int) -> dict | None:
    """Remove a document row. Returns the deleted row, or None if missing."""
    with Session(engine) as s:
        row = s.get(Document, doc_id)
        if not row:
            return None
        data = row.model_dump()
        s.delete(row)
        s.commit()
        return data
