FROM python:3.13-slim

WORKDIR /app

# System libs Chromium/Chroma sometimes need on slim images
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy app files first
COPY pyproject.toml README.md ./
COPY main.py rag.py db.py voice.py ./
COPY static ./static
COPY templates ./templates

# Install only the dependencies listed in pyproject.toml (not the app as a package).
# Avoids setuptools treating static/ and templates/ as Python packages.
RUN pip install --no-cache-dir \
    "fastapi" \
    "uvicorn[standard]" \
    "python-multipart" \
    "langchain" \
    "langchain-google-genai" \
    "langchain-chroma" \
    "langchain-community" \
    "langchain-text-splitters" \
    "chromadb" \
    "pypdf" \
    "edge-tts" \
    "python-dotenv" \
    "sqlmodel>=0.0.39" \
    "jinja2>=3.1.6"

EXPOSE 8000

# EasyPanel may pass this as a build-arg; runtime -e also works
ARG GOOGLE_API_KEY=""
ENV GOOGLE_API_KEY=${GOOGLE_API_KEY}

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
