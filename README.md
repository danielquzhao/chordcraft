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

## Edit agent (command line)

Runs the LangGraph edit agent against a score file and prints each step, the before/after
measures, the validation checks, and token usage. Needs `ANTHROPIC_API_KEY` in `api/.env`.

```bash
cd api && .venv/bin/python -m app.agent.cli "Turn the left hand into a walking bass line" --measures 5-8 --staff LH
```

## Checks

```bash
cd api && .venv/bin/ruff check . && .venv/bin/pytest -q
cd web && npm run lint && npm test && npm run build
```
