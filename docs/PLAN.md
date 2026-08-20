# ChordCraft plan

Cursor for music composition. Single instrument (piano, grand staff) for v1, aimed at songwriters
and arrangers. The core interaction is **editing**: select measures, press ⌘K, describe a change,
review a ghost-note diff, accept or reject.

Design mockups: https://claude.ai/artifact/8fdpAqxGUCAXUCpg8Nm6FL (editor + empty state)

## Decisions

| Area | Choice |
|---|---|
| Repo | Monorepo: `web/`, `api/`, `docs/` |
| Frontend | React, TypeScript, Vite, Zustand, TanStack Query, VexFlow, Tone.js |
| API | FastAPI, Pydantic v2, SQLAlchemy 2 (async), Alembic |
| Jobs | Redis + arq; progress over Redis pub/sub → SSE |
| Agent | LangGraph + Claude (`langchain-anthropic`) |
| Import/export | music21 (server side) |
| Auth | Supabase Auth (JWT verified by the API) |
| Deploy | Vercel (web); Railway or Fly (API, worker, Postgres, Redis) |

## Design language

Paper and ink with Linear's structure: warm off-white ground, near-black ink, 1px hairlines,
compact keyboard-first UI. Instrument Serif for titles and chord symbols, Geist for UI, Geist Mono
for shortcuts and agent steps. Blue (`#2350C8`) marks anything the agent added; orange
(`#B4531C`, dashed) marks removals. Blue/orange instead of green/red for colour-blind users.

Views: **Score** (grand staff) and **Lead sheet** (melody + chord symbols). Empty state offers
Blank score, From chords, and Import.

## Score model

One JSON model drives rendering, diffs, agent tools and versioning.

```jsonc
{
  "meta": { "title": "Autumn Sketch", "key": "D", "mode": "major",
            "time": [4, 4], "tempo": 92, "ppq": 480 },
  "measures": [
    { "n": 5, "chord": "Dmaj7", "section": "Verse",
      "notes": [
        { "id": "n_8f2a", "staff": "LH", "voice": 1,
          "pitch": "D3", "start": 0, "dur": 480, "tie": false }
      ] }
  ]
}
```

- **Stable note IDs** make diffs possible.
- **Integer ticks** (`ppq` 480) so measure sums are exact.
- **Spelled pitch names** (`F#3`), never MIDI numbers: correct enharmonics, and the LLM reasons
  better with names.
- **One chord symbol per measure** for v1 (per-beat later).

## Edit operations

Every change, from the user or the agent, is a list of ops against a base revision:

```jsonc
{ "base_revision": 12, "ops": [
  { "op": "remove_note", "id": "n_8f2a" },
  { "op": "add_note", "measure": 5, "note": { "staff": "LH", "pitch": "E3", "start": 480, "dur": 480 } },
  { "op": "update_note", "id": "n_91c0", "set": { "pitch": "C#5" } },
  { "op": "set_chord", "measure": 6, "chord": "Bm7" }
]}
```

`apply_ops()` in Python is the source of truth; a TypeScript mirror gives instant local previews.
The diff view renders `apply_ops(head, proposal.ops)` with per-note styling (added / removed /
unchanged).

## Agent (LangGraph)

```
load_context → propose_edits → validate ──fail (≤2)──▶ repair ─┐
                                   │ pass                       │
                                   ▼                  ◀─────────┘
                               summarize → stage_proposal
```

- **load_context**: selection ± 2 measures serialised compactly
  (`m5 LH: D3/q E3/q F#3/q A3/q | chord Dmaj7`).
- **propose_edits**: Claude with tools mapping 1:1 to ops. Ops outside the selection are rejected.
- **validate** (deterministic Python, not the LLM):
  - each voice in each measure sums to the time signature
  - piano range and hand span (≤ a 10th per hand)
  - parallel 5ths/8ves against the melody (warning)
  - accidental spelling vs key
- **repair**: feeds failures back; after 2 tries the proposal is staged with warnings.
- Each node publishes a progress event for the agent panel.

## Async flow

1. `POST /scores/{id}/edits {instruction, selection, base_revision}` → `edit_jobs` row
   (`queued`), enqueue in arq, return `job_id`.
2. Worker runs the graph, publishes progress to Redis channel `job:{id}`.
3. `GET /jobs/{id}/events` streams the channel as SSE.
4. Finished graph writes a `proposals` row (ops, validation report, summary).
5. `POST /proposals/{id}/accept` applies ops and creates a revision. If head moved since
   `base_revision`: apply if the touched note IDs are unchanged, else `409` and offer a re-run.

## Database

| Table | Key columns |
|---|---|
| `scores` | id, owner_id, title, head_revision_id, created_at |
| `revisions` | id, score_id, parent_id, number, author (`user`/`agent`), message, snapshot JSONB, ops JSONB, created_at |
| `edit_jobs` | id, score_id, base_revision_id, instruction, selection JSONB, status, error, timings |
| `proposals` | id, job_id, ops JSONB, validation JSONB, summary, status (`pending`/`accepted`/`rejected`) |
| `messages` | id, score_id, role, content, job_id |

- Full snapshot per revision (a 32-bar piano score is a few KB): restore is one read; `ops` give
  cheap "what changed" for History.
- Manual edits autosave with a debounce and coalesce into one revision per editing burst
  (~30 s idle), so not every note becomes a revision.

## Frontend layout

```
web/src/
  score/     model types, applyOps.ts, layout (measures → systems)
  render/    VexFlow renderer, ghost-note styling, selection hit-testing
  input/     keyboard note entry (A–G, 1–7 durations, arrows, ⌘K)
  playback/  Tone.js scheduler + playhead
  agent/     chat panel, inline edit bar, SSE hook, proposal state
  views/     Editor, LeadSheet, NewScore, History
```

TypeScript API types are generated from FastAPI's OpenAPI schema.

## Milestones

| # | Milestone | Done when | Status |
|---|---|---|---|
| M0 | Scaffolding | Monorepo, Docker Compose, FastAPI health check, Vite app, CI | Done |
| M1 | Score core | Model, `apply_ops` (Py + TS) with tests, VexFlow grand staff, keyboard entry, playback | |
| M2 | Persistence | Scores + revisions in Postgres, autosave, History panel with restore | |
| M3 | Agent (sync) | LangGraph agent + validator working via a CLI/test harness on fixture scores | |
| M4 | Async + diff | arq jobs, SSE progress, ghost-note diff, accept/reject/undo | |
| M5 | Product surface | Chat with @-mentions, lead sheet, empty-state flows, MusicXML/MIDI import | |
| M6 | Polish | Tab autocomplete, Supabase auth, deploy | |

M3 precedes M4 on purpose: edit quality is the risky part, so prove it before wiring the queue.
