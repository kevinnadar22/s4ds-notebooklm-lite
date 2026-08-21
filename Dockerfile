FROM python:3.13-slim

WORKDIR /app

# Install Python deps from pyproject.toml
COPY pyproject.toml README.md ./
COPY main.py rag.py db.py voice.py ./
COPY static ./static
COPY templates ./templates

RUN pip install --no-cache-dir .

EXPOSE 8000

# Pass your key at runtime: -e GOOGLE_API_KEY=...
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
