"""PDF ingest + Chroma RAG answers with Google Gemini.

Flow: PDF → extract text → chunk → embed into Chroma → retrieve → Gemini answer.
Modes only change the system-style instruction (conversing vs quiz).
"""

from __future__ import annotations

import os
from pathlib import Path

from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

CHROMA_DIR = str(Path("chroma_db"))
COLLECTION_NAME = "pdfs"

# Small chunks keep retrieval simple for beginners / short PDFs
CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
TOP_K = 4

PROMPTS = {
    "conversing": (
        "You are a friendly, helpful assistant for a document Q&A app.\n"
        "- If the Context below has useful source text, prefer it for factual answers "
        "about the user's documents.\n"
        "- If Context is empty, missing, or irrelevant (greetings, small talk, general "
        "questions), reply normally as a helpful chat assistant. Do NOT say you do not know "
        "just because there is no PDF context.\n"
        "- Use Previous turns for continuity when helpful.\n\n"
        "Previous turns:\n{history}\n\n"
        "Context:\n{context}\n\n"
        "User: {question}\n\nAssistant:"
    ),
    "quiz": (
        "You are a quiz tutor agent. Run an interactive quiz ONE QUESTION AT A TIME.\n\n"
        "Hard rules:\n"
        "- Ask exactly ONE unanswered question per reply. Never list a full quiz.\n"
        "- Prefer multiple-choice A–D grounded in Context when Context has document text.\n"
        "- Wait for the user's answer in the next turn before asking another new question.\n"
        "- When the user answers: first say Correct or Incorrect, give a 1–2 sentence "
        "explanation, update a running score (e.g. Score: 2/4), THEN ask the next "
        "question in the same reply.\n"
        "- Aim for about 5 questions, then give a short wrap-up and offer another round.\n"
        "- If the user says start / ready / quiz me / begin (or similar), start with "
        "question 1 only.\n"
        "- If Context is empty, ask them to upload a PDF, or run a light general quiz "
        "if they clearly want that.\n"
        "- Do not spoil upcoming answers. Do not ask several questions before they answer.\n"
        "- Keep replies concise and encouraging.\n\n"
        "Previous turns:\n{history}\n\n"
        "Context:\n{context}\n\n"
        "Latest user message: {question}\n\n"
        "Your reply:"
    ),
}


def _embeddings() -> GoogleGenerativeAIEmbeddings:
    return GoogleGenerativeAIEmbeddings(
        model="models/gemini-embedding-001",
        google_api_key=os.environ["GOOGLE_API_KEY"],
    )


def _llm() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model="gemini-3.1-flash-lite",
        google_api_key=os.environ["GOOGLE_API_KEY"],
        temperature=0.2,
    )


def _vectorstore() -> Chroma:
    return Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function=_embeddings(),
        persist_directory=CHROMA_DIR,
    )


def ingest_pdf(path: str | Path) -> int:
    """Load a PDF, split it, and store chunks in Chroma. Returns chunk count."""
    path = Path(path)
    loader = PyPDFLoader(str(path))
    docs = loader.load()

    # Tag every chunk with the source filename for later debugging
    for doc in docs:
        doc.metadata["source"] = path.name

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )
    chunks = splitter.split_documents(docs)
    if not chunks:
        return 0

    store = _vectorstore()
    store.add_documents(chunks)
    return len(chunks)


def delete_pdf_chunks(filename: str) -> int:
    """Remove all Chroma chunks whose metadata source matches filename."""
    store = _vectorstore()
    collection = store._collection
    try:
        existing = collection.get(where={"source": filename})
    except Exception:  # noqa: BLE001
        return 0
    ids = existing.get("ids") or []
    if not ids:
        return 0
    collection.delete(ids=ids)
    return len(ids)


def retrieve(question: str, k: int = TOP_K) -> list[dict]:
    """Return top-k chunks with distance + relevance scores for the UI."""
    try:
        pairs = _vectorstore().similarity_search_with_score(question, k=k)
    except Exception:  # noqa: BLE001 — empty/broken store
        return []

    hits: list[dict] = []
    for doc, distance in pairs:
        dist = float(distance)
        hits.append(
            {
                "text": doc.page_content,
                "source": doc.metadata.get("source", "unknown"),
                "page": doc.metadata.get("page"),
                # Chroma distance: lower is closer. relevance is easier to read (0–1-ish).
                "distance": round(dist, 4),
                "relevance": round(1.0 / (1.0 + dist), 4),
            }
        )
    return hits


def retrieve_for_mode(question: str, mode: str, k: int = TOP_K) -> list[dict]:
    """Quiz starts often use short phrases like 'start' — seed a broader topic query."""
    q = question.strip()
    if mode == "quiz" and len(q.split()) <= 4:
        q = f"{q} key concepts definitions important facts summary"
    return retrieve(q, k=k)


def format_history(messages: list[dict], *, limit: int = 24) -> str:
    """Format prior turns for the prompt (oldest → newest)."""
    if not messages:
        return "(none yet)"
    lines: list[str] = []
    for msg in messages[-limit:]:
        role = msg.get("role", "user")
        label = "User" if role == "user" else "Assistant"
        content = (msg.get("content") or "").strip()
        if content:
            lines.append(f"{label}: {content}")
    return "\n".join(lines) if lines else "(none yet)"


def _chunk_text(chunk) -> str:
    text = chunk.content
    if isinstance(text, list):
        return "".join(
            part.get("text", "") if isinstance(part, dict) else getattr(part, "text", str(part))
            for part in text
        )
    return str(text) if text else ""


def stream_answer(
    question: str,
    mode: str,
    context: str,
    *,
    spoken: bool = False,
    history: str = "(none yet)",
):
    """Stream Gemini tokens for a prepared context string."""
    if spoken:
        if mode == "quiz":
            prompt = (
                "You are a live voice quiz tutor. Ask ONE question at a time. "
                "After they answer, say correct or incorrect briefly, keep score, "
                "then ask the next question. No markdown, short spoken sentences.\n\n"
                f"PREVIOUS TURNS:\n{history}\n\n"
                f"KNOWLEDGE:\n{context}\n\n"
                f"USER SAID:\n{question}\n\n"
                "YOUR SPOKEN REPLY:"
            )
        else:
            prompt = (
                "You are a live voice assistant in a natural conversation. "
                "Reply in short, clear spoken sentences — no markdown, no bullet lists, "
                "no stage directions. Use KNOWLEDGE when it helps; otherwise chat normally.\n\n"
                f"PREVIOUS TURNS:\n{history}\n\n"
                f"KNOWLEDGE:\n{context}\n\n"
                f"USER SAID:\n{question}\n\n"
                "YOUR SPOKEN REPLY:"
            )
    else:
        if mode not in PROMPTS:
            raise ValueError(f"unknown mode: {mode}")
        prompt = PROMPTS[mode].format(
            context=context, question=question, history=history or "(none yet)"
        )

    for chunk in _llm().stream(prompt):
        text = _chunk_text(chunk)
        if text:
            yield text


def answer_with_retrieval(
    question: str,
    mode: str = "conversing",
    *,
    spoken: bool = False,
    history: str = "(none yet)",
) -> tuple[str, list[dict]]:
    """RAG beside the turn: retrieve first, then answer (used by voice agent)."""
    hits = retrieve_for_mode(question, mode)
    context = (
        "\n\n".join(h["text"] for h in hits) if hits else "(no documents uploaded yet)"
    )
    text = "".join(
        stream_answer(question, mode, context, spoken=spoken, history=history)
    ).strip()
    return text, hits


def answer_stream(question: str, mode: str = "conversing", history: str = "(none yet)"):
    """Retrieve + stream tokens (text chat helper)."""
    hits = retrieve_for_mode(question, mode)
    context = (
        "\n\n".join(h["text"] for h in hits) if hits else "(no documents uploaded yet)"
    )
    yield from stream_answer(question, mode, context, history=history)


def answer(question: str, mode: str = "conversing") -> str:
    """Non-streaming helper."""
    text, _ = answer_with_retrieval(question, mode)
    return text
