# s4ds-notebooklm-lite

A beginner-friendly **NotebookLM-style** app:

- Upload a PDF
- Ask questions (Chat) or take a quiz (one question at a time)
- Optional voice chat
- Built with FastAPI + Gemini + Chroma + plain HTML/CSS/JS

---

## What you need

1. **Python 3.13+** ([download](https://www.python.org/downloads/))
2. A **Google AI API key** from [Google AI Studio](https://aistudio.google.com/apikey)
3. (Recommended) **[uv](https://docs.astral.sh/uv/)** — fast Python package installer  
   Or use plain `pip` if you prefer.

---

## Run locally (beginners)

### 1. Open a terminal in this folder

```bash
cd s4ds-notebooklm-lite
```

### 2. Create your `.env` file

Copy the example file and add your key:

Rename the `.env.example` file to `.env` and add your key.

Edit `.env` and set:

```env
GOOGLE_API_KEY=paste_your_key_here
```

### 3. Install dependencies

**With uv (recommended):**

```
pip instal uv
uv sync
```

**With pip:**

```bash
python -m venv .venv

# Windows (PowerShell / Git Bash)
source .venv/Scripts/activate

# macOS / Linux
# source .venv/bin/activate

pip install .
```

### 4. Start the app

**With uv:**

```bash
uv run uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

**With pip / venv activated:**

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### 5. Open it in your browser

Go to: [http://127.0.0.1:8000](http://127.0.0.1:8000)

- Upload a PDF from the chat bar (**Upload PDF**)
- Use **Chat** or **Quiz**
- Mic opens the voice agent (speak, then tap ✓ to send)

Stop the server with `Ctrl + C`.

---

## Project layout (simple map)

| Path | What it is |
|------|------------|
| `main.py` | FastAPI app (routes + API) |
| `rag.py` | PDF → Chroma → Gemini answers |
| `db.py` | SQLite sessions / messages |
| `voice.py` | Speech-to-text + text-to-speech |
| `templates/` | HTML pages |
| `static/` | CSS, JS, images |
| `Dockerfile` | Run the app in Docker |

---

## Troubleshooting

- **`GOOGLE_API_KEY is not set`** — create `.env` from `.env.example` and restart the server.
- **Port already in use** — change `--port 8001` (and open that URL).
- **Upload / quiz feels empty** — upload a PDF first, then ask or say “start quiz”.
