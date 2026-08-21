"""FastAPI entrypoint for NotebookLM-lite (UI + API).

Pages:  GET /  GET /chat
API:    GET /health  POST /upload  POST /sessions
        GET /sessions/{id}/messages  POST /ask  POST /ask-voice
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

import db
import rag
import voice

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
Path("data").mkdir(parents=True, exist_ok=True)
Path("chroma_db").mkdir(parents=True, exist_ok=True)

db.init_db()

app = FastAPI(title="s4ds-notebooklm-lite", version="0.1.0")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

# Same-origin UI + API; CORS kept open for local experiments
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home(request: Request):
    """Main chat UI."""
    return templates.TemplateResponse(request, "index.html")


@app.get("/chat")
def chat_page(request: Request):
    """Alias route for the same chat UI."""
    return templates.TemplateResponse(request, "index.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return RedirectResponse(url="/static/favicon.svg")


class SessionCreate(BaseModel):
    mode: str = Field(default="conversing", description="conversing | quiz")


class AskRequest(BaseModel):
    session_id: int
    question: str


def _require_api_key() -> None:
    if not os.environ.get("GOOGLE_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_API_KEY is not set. Copy .env.example to .env and add your key.",
        )


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)) -> dict:
    """Save a PDF and ingest its text into Chroma."""
    _require_api_key()
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="only PDF files are supported")

    dest = UPLOAD_DIR / Path(file.filename).name
    content = await file.read()
    dest.write_bytes(content)

    try:
        chunks = rag.ingest_pdf(dest)
    except Exception as exc:  # noqa: BLE001 — surface ingest errors clearly for beginners
        raise HTTPException(status_code=500, detail=f"ingest failed: {exc}") from exc

    doc = db.upsert_document(dest.name, chunks, len(content))
    return {"filename": dest.name, "chunks": chunks, "document": doc}


@app.get("/documents")
def get_documents() -> dict:
    """List indexed PDFs for the left library panel."""
    return {"documents": db.list_documents()}


@app.post("/sessions")
def create_session(body: SessionCreate) -> dict:
    try:
        return db.create_session(body.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/sessions/{session_id}/messages")
def get_messages(session_id: int) -> dict:
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    return {"session": session, "messages": db.list_messages(session_id)}


@app.post("/ask")
def ask(body: AskRequest):
    """NDJSON stream: sources event, then token events, then done."""
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    _require_api_key()
    session = db.get_session(body.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")

    question = body.question.strip()
    prior = db.list_messages(body.session_id)
    db.add_message(body.session_id, "user", question)
    history = rag.format_history(prior)

    def event_stream():
        parts: list[str] = []
        try:
            hits = rag.retrieve_for_mode(question, session["mode"])
            yield json.dumps({"type": "sources", "chunks": hits}) + "\n"

            context = (
                "\n\n".join(h["text"] for h in hits)
                if hits
                else "(no documents uploaded yet)"
            )
            for token in rag.stream_answer(
                question, session["mode"], context, history=history
            ):
                parts.append(token)
                yield json.dumps({"type": "token", "text": token}) + "\n"
        except Exception as exc:  # noqa: BLE001
            msg = f"answer failed: {exc}"
            parts.append(msg)
            yield json.dumps({"type": "error", "text": msg}) + "\n"
        finally:
            answer_text = "".join(parts).strip()
            if answer_text:
                db.add_message(body.session_id, "assistant", answer_text)
            yield json.dumps({"type": "done"}) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@app.post("/ask-voice")
async def ask_voice(
    session_id: int = Form(...),
    audio: UploadFile = File(...),
) -> dict:
    """Live-style voice turn: mic → STT → RAG retrieve → spoken answer → TTS.

    RAG sits beside the turn (not inside audio codecs): retrieve chunks from the
    transcript, then answer with that knowledge, then synthesize speech.
    Returns JSON so unicode answers never break HTTP headers.
    """
    import asyncio

    _require_api_key()
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="empty audio upload")

    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")

    mime = audio.content_type or "audio/webm"
    try:
        transcript = await asyncio.to_thread(voice.transcribe, audio_bytes, mime)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"transcription failed: {exc}") from exc

    prior = db.list_messages(session_id)
    db.add_message(session_id, "user", transcript)
    history = rag.format_history(prior)

    try:
        answer_text, chunks = await asyncio.to_thread(
            lambda: rag.answer_with_retrieval(
                transcript,
                session["mode"],
                spoken=True,
                history=history,
            )
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"answer failed: {exc}") from exc

    db.add_message(session_id, "assistant", answer_text)

    try:
        mp3 = await voice.speak_async(answer_text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"tts failed: {exc}") from exc

    return {
        "session_id": session_id,
        "transcript": transcript,
        "answer": answer_text,
        "chunks": chunks,
        "audio_base64": base64.b64encode(mp3).decode("ascii"),
        "audio_mime": "audio/mpeg",
    }


def main() -> None:
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)


if __name__ == "__main__":
    main()
