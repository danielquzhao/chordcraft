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
| Agent | LangGraph for the flow; model calls through a provider adapter: Claude (`anthropic` SDK) or Gemini (`google-genai`), chosen by model name |
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
context → model ⇄ tools → validate ─pass─▶ proposal
             ▲                │ fail (≤ 2 repairs)
             └────────────────┘
```

Code: `api/app/agent/` (`graph.py`, `tools.py`, `validate.py`, `context.py`, `model.py`).

- **context**: the selection ± 2 measures as compact text, one line per hand
  (`LH: n_m5lh1 D3 @1 whole`), marked editable or read-only.
- **propose_edits**: Claude with strict tools that map 1:1 to ops (`add_note`, `remove_note`,
  `update_note`, `set_chord`) plus `submit_edit`. Calls apply to a draft immediately and return
  precise errors; anything outside the selection is rejected. Rhythm is in beats and note names
  (`start_beat: 2.5`, `duration: "eighth"`), converted to ticks by the tool.
- **validate** (deterministic Python, not the LLM), reporting only problems the edit introduced:
  - rhythm: no overlaps, chord tones share a length (fail)
  - hand span ≤ a tenth (fail)
  - comfortable range for each hand (warning)
  - parallel 5ths/8ves between bass and melody, compared once per beat so broken-chord
    figures don't count as the bass line (warning)
  - accidentals spelled for the key (warning)
- **repair**: failures go back as the `submit_edit` tool result, at most twice; after that the
  proposal is returned with the failures shown.
- Model calls: Claude Sonnet 5.5 at `effort: medium` by default (tested: ~2–10¢ an edit, 2–3
  turns), adaptive thinking, prompt caching,
  server-side refusal fallback. Forced `tool_choice` isn't allowed, so the prompt asks for tools
  and a text-only answer gets one nudge before it's accepted as the reply.
- Providers: `make_model()` sends `gemini-*` model ids to the Gemini adapter (`gemini.py`) and
  everything else to Claude. The graph keeps one conversation format; each adapter translates it
  and passes the model's own reply back verbatim (Claude thinking blocks, Gemini thought
  signatures). Gemini 3.8 Flash works but tested worse: one tool call per turn with long
  thinking, so 3 of 4 test edits passed and they cost more than Sonnet overall.
- Each node emits a step event, which M4 relays to the agent panel.
- CLI harness: `python -m app.agent.cli` (see README). Tests use a scripted fake model.

## Async flow

Code: `api/app/edits/` (service, router, events), `api/app/worker.py`, `web/src/agent/`.

1. `POST /scores/{id}/edits {instruction, selection, base}` → an `edit_jobs` row (`queued`),
   enqueued in arq. 409 if `base` isn't the head (the client flushes its saves first).
2. The worker runs the agent and publishes each step to Redis: a pub/sub channel plus a
   short-lived log, every event numbered.
3. `GET /edits/{id}/events` streams them as SSE, replaying the log first so a late or
   reconnecting browser misses nothing; it ends with a `done` event.
4. The finished proposal (ops, summary, checks, steps, drafted score) is stored on the job.
5. `POST /edits/{id}/accept` saves it as an agent revision (message = the request). If the
   head moved since `base`, it still applies when the notes and chords it touches are
   unchanged; otherwise 409. `POST /edits/{id}/reject` discards it (also cancels a running
   job: the worker won't overwrite a rejected job).

In the editor: Shift+click or Shift+arrows select measures, ⌘K opens the inline bar (hands:
both, right or left), progress streams in, and the proposal shows as a ghost-note diff
(added notes blue, removed notes faded orange as a second voice) with Accept (⌘↵) and Reject
(⌘⌫). Manual editing is locked while an edit runs or is under review. Accepted edits go on
the undo stack, so ⌘Z reverts them like any other change.

## Chat, lead sheet, new scores

- **Chat** (`api/app/chat/`, `web/src/agent/ChatPanel.tsx`): a conversation per score. Each
  message runs as an edit job with the last few messages as history, so follow-ups work. A
  question gets a plain-text answer (no edit); a change comes back as the same ghost-note
  proposal as ⌘K. `@m.5–8`, `@m3`, `@LH`, `@RH`, `@all` set the scope; otherwise the selection
  or the whole score. ⌘L shows or hides the panel.
- **Lead sheet**: the renderer's `lead` view draws only the melody staff with large chord
  symbols; the cursor stays on the right hand there.
- **New score** (`/new`): Blank (key, meter, tempo, length, with a live preview), From chords
  (a typed progression; the agent writes the part as a reviewable draft), or Import.
- **Import** (`api/app/scores/importer.py`, music21): MusicXML or MIDI. Two parts map to the
  hands; a single part splits at middle C. Timing snaps to a 32nd grid; overlapping notes in a
  hand are trimmed so each hand stays one line. Key, meter, tempo, title and chord symbols carry
  over.

## Database

| Table | Key columns |
|---|---|
| `scores` | id, owner_id, title, head (current version number), created_at, updated_at |
| `revisions` | id, score_id, number, author (`user`/`agent`), kind (`create`/`edit`/`restore`), message, snapshot JSONB, ops JSONB, changes JSONB, created_at |
| `edit_jobs` | id, score_id, base (version), instruction, selection JSONB, status (`queued`/`running`/`ready`/`failed`/`accepted`/`rejected`), model, proposal JSONB, error, accepted_revision |
| `messages` | id, score_id, role (`user`/`assistant`), content, job_id (chat requests run as edit jobs with `source = chat`) |

- Revisions are immutable: every save appends one with a full snapshot (a 32-bar piano score is a
  few KB), so restore is one read and a saved version number always means the same content. That
  keeps `base` checks honest for agent proposals in M4. Restoring appends a new revision.
- The client autosaves ~0.8 s after typing stops, one request at a time, each with the `base`
  version it was made against (409 if stale). The History panel groups consecutive user edits
  less than a minute apart into one entry, labelled from the `changes` column
  ("Edited notes in m. 3–5, changed tempo").
- Undo is ops-based: applying ops also yields their inverse, so undo/redo are ordinary edits that
  save like any other.

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
| M1 | Score core | Model, `apply_ops` (Py + TS) with tests, VexFlow grand staff, keyboard entry, playback | Done |
| M2 | Persistence | Scores + revisions in Postgres, autosave, History panel with restore | Done |
| M3 | Agent (sync) | LangGraph agent + validator working via a CLI/test harness on fixture scores | Done |
| M4 | Async + diff | arq jobs, SSE progress, ghost-note diff, accept/reject/undo | Done |
| M5 | Product surface | Chat with @-mentions, lead sheet, empty-state flows, MusicXML/MIDI import | Done |
| M6 | Polish | Tab autocomplete, Supabase auth, deploy | |

M3 precedes M4 on purpose: edit quality is the risky part, so prove it before wiring the queue.
