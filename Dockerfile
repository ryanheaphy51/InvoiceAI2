FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY client client
COPY server server

EXPOSE 8000

CMD ["python", "server/app.py"]
