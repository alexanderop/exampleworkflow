# AFK Workflow

An [**AFK coding pipeline**](https://alexanderop.github.io/) built on top of
[`defineworkflow`](https://github.com/alexanderop/defineworkflow) — the
deterministic, crash-safe multi-agent workflow engine.

> **HITL at the edges, AFK in the middle.** You align on the spec and review the
> PR. Everything between — slice, implement, refactor, QA — runs without you.

## The pipeline

The article's six phases. Phases 1 and 6 are yours; the four in the middle are
this workflow (`workflows/afk-pipeline.workflow.ts`):

```
1. Align on spec        ── HITL ──  you + business + an AI interviewer
2. Slice the ticket     ── AFK  ──  PRD → vertical, shippable slices
3. Ralph loop per slice ── AFK  ──  fresh-context agent, TDD red-green-refactor
4. Refactor pass        ── AFK  ──  the /simplify step LLMs always skip
5. Agentic QA           ── AFK  ──  agent-browser drives the real UI
6. Review               ── HITL ──  you review the diff, business does UAT
```

Each AFK phase maps to a primitive:

| Phase | Primitive | What runs |
|-------|-----------|-----------|
| Slice | `agent({ schema })` | one slicer agent → validated `slices[]` |
| Ralph loop | `parallel()` + per-slice loop | one fresh-context TDD agent per iteration, per slice |
| Refactor | `agent()` | a single `/simplify` pass over the merged branch |
| QA | `agent({ schema })` | an `agent-browser` QA agent → validated report |

The Ralph loop calls `agent()` once per iteration — **a fresh context every
time**, mirroring `while :; do cat PROMPT.md | claude; done` — and stops when the
agent reports `remaining: 0`, exactly like Ralph's `grep -q "^- \[ \]" || break`.

## Setup

Requires Node ≥20 and pnpm. Already installed here; from scratch:

```bash
pnpm install
```

`defineworkflow` runs against the `claude`, `codex`, `copilot`, or `raw-api`
harness — set by the `harness` field in each workflow file. Check what's on your
PATH:

```bash
pnpm adapters
```

## Run it

**Dry-run (no agents, no tokens)** — iterate on control flow, phases, and the UI:

```bash
pnpm afk:mock --args '{"prd":"docs/prd-booking-wizard.md"}'
```

**For real** (spawns agents, spends tokens):

```bash
pnpm afk --args '{"prd":"docs/prd-booking-wizard.md","appUrl":"http://localhost:3000/book"}'
```

`--args` accepts:

| key | default | meaning |
|-----|---------|---------|
| `prd` | `docs/prd-booking-wizard.md` | path to your PRD (write it in Phase 1) |
| `appUrl` | `http://localhost:3000` | URL the QA agent drives in Phase 5 |

Smoke-test the engine first if you like:

```bash
pnpm haiku:mock
```

## Your two jobs (the HITL edges)

**Phase 1 — write the spec.** The pipeline is only as good as the PRD it reads.
`docs/prd-booking-wizard.md` is a sample; replace it. Interview-mode helps:

```
i want to build <X>. interview me one question at a time until you can write
a PRD. cover goals, user, happy path, edge cases, validation, error states,
and out-of-scope. write it to docs/prd-<x>.md when done.
```

**Phase 6 — review.** Read the diff and the test names. Run it locally. Send the
preview URL to whoever co-wrote the PRD for UAT. An agent can't be held
accountable — you ship it.

## Layout

```
workflows/
  afk-pipeline.workflow.ts   the six-phase pipeline (AFK middle) — control flow only
  afk-pipeline/
    schemas.ts               zod schemas + inferred types for every phase
    prompts.ts               the prompt builders, one per phase
  haiku.workflow.ts          minimal smoke test
docs/
  prd-booking-wizard.md      sample PRD — replace with your own
scripts/
  ralph.sh                   standalone bash Ralph driver (worktree-per-ticket)
```

Since `defineworkflow` 0.5.0 the runner bundles relative imports (esbuild
`bundle: true` + a local-only resolver), so schemas and prompts live in their own
files under `workflows/afk-pipeline/` and get inlined before the run. A workflow
may only import **local files** (`./…`, `../…`) or **`"defineworkflow"`** —
anything else is rejected at bundle time.

## Engine gotchas (baked into the workflows here)

`defineworkflow` runs workflow bodies in a deterministic VM sandbox. Two rules
the files in `workflows/` already follow:

- **`import { z } from "defineworkflow"`**, not from `"zod"` — including in the
  sibling `schemas.ts`. The sandbox strips the `defineworkflow` import and injects
  the engine's own `z`; a raw `zod` import can't be resolved and fails to transform.
- **Split schemas and prompts into sibling files** and import them relatively
  (`./afk-pipeline/schemas`, `./afk-pipeline/prompts`). 0.5.0 bundles those in, so
  the main workflow file is just control flow — no need to cram everything into
  `run()` as 0.4.0 required.
- **Runtime primitives** (`agent`, `parallel`, `phase`, `log`, `args`) can be
  imported from `"defineworkflow"` *or* destructured from `run()`'s context —
  both resolve to the same injected runtime. We import them here because the
  importable stubs carry the schema-generic overload, so `agent({ schema })`'s
  return type is inferred; the context-injected versions return `unknown`.
- **No `Date.now()`, `Math.random()`, or argless `new Date()`** in a workflow
  body — they'd break journal replay. Pass timestamps via `--args`.

## How durability works

Every `agent()` result is appended to a per-run journal keyed by sequence
number. If a run crashes or you stop it, resume replays the journal and only
re-invokes the model for steps that never completed:

```bash
pnpm list                 # defineworkflow list — run ids + status
pnpm exec defineworkflow resume <id>
```
