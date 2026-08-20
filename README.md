# ChordCraft

Cursor for music composition: a piano score editor where you select measures, describe a change,
and review the AI's edit as a ghost-note diff before accepting it.

See [docs/PLAN.md](docs/PLAN.md) for the architecture and roadmap.

## Layout

```
web/   React + TypeScript + Vite (VexFlow notation, Tone.js playback)
api/   FastAPI, SQLAlchemy, Alembic, arq worker (LangGraph agent)
docs/  Plan and design notes
```

## Local development

Start Postgres and Redis:

```bash
docker compose up -d
```

API (from `api/`):

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp .env.example .env
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload
```

Worker (from `api/`):

```bash
.venv/bin/arq app.worker.WorkerSettings
```

Web (from `web/`):

```bash
npm install
npm run dev
```

The web app proxies `/api/*` to `http://localhost:8000`. Open http://localhost:5173 and the
health panel should report `postgres: true` and `redis: true`.

## Checks

```bash
cd api && .venv/bin/ruff check . && .venv/bin/pytest -q
cd web && npm run lint && npm run build
```
