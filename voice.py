"""Voice agent helpers: STT + TTS.

Live voice turn flow (RAG sits beside the turn, not in the audio pipeline):

  mic audio → Gemini STT (transcript)
           → Chroma retrieve
           → Gemini spoken answer (with knowledge)
           → edge-tts audio
"""

from __future__ import annotations

import asyncio
import os

import edge_tts
from google import genai
from google.genai import types

# One clear English voice keeps the prototype simple
DEFAULT_VOICE = "en-US-JennyNeural"
STT_MODEL = "gemini-3.1-flash-lite"


def transcribe(audio_bytes: bytes, mime: str = "audio/webm") -> str:
    """Send audio to Gemini and return a plain-text transcript."""
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
    response = client.models.generate_content(
        model=STT_MODEL,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_bytes(data=audio_bytes, mime_type=mime),
                    types.Part.from_text(
                        text="Transcribe the spoken words verbatim. Reply with only the transcript."
                    ),
                ],
            )
        ],
        # Plain STT — disable automatic function calling to avoid AFC warnings / hangs
        config=types.GenerateContentConfig(
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )
    text = (response.text or "").strip()
    if not text:
        raise ValueError("empty transcript from speech-to-text")
    return text


async def speak_async(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """Async TTS — use this from FastAPI async routes."""
    communicate = edge_tts.Communicate(text, voice)
    chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
    return b"".join(chunks)


def speak(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """Sync wrapper for scripts / smoke tests outside an event loop."""
    return asyncio.run(speak_async(text, voice=voice))
