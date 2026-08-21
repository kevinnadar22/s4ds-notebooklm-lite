Here’s how this app works end-to-end, in plain terms.

## Big picture

```text
PDF upload → extract text → split into chunks → turn chunks into vectors → store in Chroma
                                                                              ↓
User question → embed question → find similar chunks → paste into a prompt → Gemini answers
```

That pattern is called **RAG** (Retrieval-Augmented Generation): the LLM doesn’t “read the whole PDF every time.” You **retrieve** the relevant bits first, then ask the model to answer using those bits.

---

## 1. Text extraction from PDFs (`rag.ingest_pdf`)

When you upload a PDF (`POST /upload` in `main.py`):

1. File is saved under `uploads/`
2. `PyPDFLoader` (LangChain + `pypdf`) opens the PDF and pulls **plain text per page**
3. Each page becomes a “document” with metadata (later tagged with the filename)

PDFs are not images here — this path is **text extraction**, not OCR. Scanned image-only PDFs won’t give good text.

---

## 2. Chunking (why we split text)

LLMs and embedding models have size limits, and one giant blob is hard to search.

`RecursiveCharacterTextSplitter` cuts text into pieces of about **800 characters**, with **100 characters of overlap** so sentences aren’t chopped awkwardly.

Those pieces are called **chunks**. They’re what get stored and searched later.

---

## 3. Vectors / embeddings (the “AI memory” of your PDF)

A **vector** (embedding) is a long list of numbers that represents meaning.

- Similar text → similar numbers (close in space)
- Unrelated text → far apart

This app uses Google’s embedding model:

```text
models/gemini-embedding-001
```

via `GoogleGenerativeAIEmbeddings` in `rag.py`.

Flow:

1. Each chunk → embedding API → vector  
2. Vectors are saved in **Chroma** (`chroma_db/` folder)  
3. Metadata like `source` (filename) and `page` is stored with them  

Chroma is a **vector database**: optimized for “find the closest vectors to this query.”

---

## 4. Asking a question (retrieve → answer)

When you send a chat message (`POST /ask`):

1. **Retrieve:** your question is also turned into a vector, then Chroma finds the top **4** similar chunks (`TOP_K = 4`)
2. Those chunks become `Context` in the prompt
3. **Generate:** Gemini (`gemini-3.1-flash-lite`) writes the answer using that context (+ chat history)

So the LLM sees something like:

```text
Previous turns: ...
Context: [relevant PDF snippets]
User: your question
Assistant:
```

If no PDF / weak matches, context is empty and the chat prompt says: still be a normal helpful assistant (don’t fake “I only know PDFs”).

**Quiz mode** uses the same retrieve + Gemini path, but a different prompt: ask **one** question at a time, grade answers, keep score, using history so it remembers what was already asked.

---

## 5. What the “LLM” is doing

| Piece | Model / tool | Job |
|--------|----------------|-----|
| Embeddings | `gemini-embedding-001` | Turn text → vectors for search |
| Chat / quiz | `gemini-3.1-flash-lite` | Write answers / quiz turns |
| STT (voice → text) | same Gemini flash-lite | Listen to audio, return transcript |
| TTS (text → voice) | `edge-tts` (Microsoft Jenny) | Speak the answer aloud |

Temperature `0.2` keeps answers fairly steady (less random).

Streaming (`stream_answer`): Gemini returns tokens gradually; the UI paints them as they arrive (NDJSON: `sources` → `token` → `done`).

---

## 6. How voice works (`voice.py` + `/ask-voice`)

Voice is **not** a separate “live Gemini microphone model.” It’s a loop:

```text
Mic recording (browser)
  → upload audio bytes
  → Gemini STT: “transcribe only”
  → same RAG as text chat (retrieve + answer, spoken-style prompt)
  → edge-tts turns answer into MP3
  → browser plays it
```

Important details:

- **STT:** audio + instruction “Transcribe… only the transcript”  
- **AFC disabled** so Gemini doesn’t try tool/function calling during STT  
- **TTS:** `edge-tts` is local/network TTS, not Gemini  
- RAG sits **beside** voice: audio never goes into Chroma; only the **transcript text** is used for retrieval  

UI: you speak, tap ✓ to send (manual end), then hear the reply.

---

## 7. What SQLite stores (`db.py`) — vs Chroma

| Store | Holds |
|--------|--------|
| **SQLite** (`data/app.db`) | Sessions, chat messages, document list (filename, chunk count) |
| **Chroma** (`chroma_db/`) | Actual searchable chunk text + vectors |

History for quiz/chat continuity comes from SQLite messages, then gets formatted into the prompt (`format_history`).

---

## 8. Mental model in one sentence

**Extract PDF text → embed chunks as vectors in Chroma → on each question, find nearby chunks → give those to Gemini → return text (and optionally TTS audio).**

That’s the core of this NotebookLM-lite stack.