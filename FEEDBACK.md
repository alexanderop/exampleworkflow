# Feedback on `defineworkflow` (v0.4.0)

Context: I set up a fresh project using `defineworkflow@0.4.0` from npm to build an
"AFK coding" pipeline (spec → slice → Ralph/TDD loop → refactor → agentic QA →
review). These are the friction points I hit, in order of how much they cost me.
All three big ones are in the authoring/transform layer — the part a new user
meets first.

## Top issues

### 1. `import { z } from "zod"` is a silent trap

It's the natural thing to type — every TS dev's muscle memory — and it fails with:

```
error: Transform failed with 1 error:
<stdin>:3:7: ERROR: Unexpected "{"
```

That esbuild error points at the import's `{` and gives zero hint that the real
fix is "import `z` from `defineworkflow` instead." The sandbox strips the
`defineworkflow` import and injects the engine's own `z`, but a raw `zod` import
survives into the VM and can't be resolved.

**Suggested fix:** in `stripWorkflowImports` / the transform error path, detect an
unstrippable bare import that survives into the sandbox and throw a
`SandboxViolation` that names the offending module and suggests the
`defineworkflow` re-export. Also: the README's "Typed outputs" bullet should show
the actual import line (`import { z } from "defineworkflow"`) — it currently
implies `z` materializes from nowhere.

### 2. `transformScript` uses non-global `.replace()` and matches inside comments

I wrote `export default defineWorkflow(...)` in a **JSDoc comment** above the real
export. The detection regex matched the comment, and the (non-global) replace
rewrote the **comment** — leaving the real `export default` untouched, which blew
up as:

```
error: Transform failed with 1 error:
<stdin>:24:0: ERROR: Unexpected "export"
```

…at a confusing line number. The detect step and the replace step desync: "test
finds *any* match, replace fixes the *first*."

**Suggested fix:** strip or skip comments before locating the export, and make
detect/replace operate on the **same** match rather than independently.

### 3. "First statement must be `defineWorkflow`" is stricter than it reads

The error message is clear once you hit it, but the mental model "put helpers and
schemas at module scope like normal TS" is wrong — everything has to live inside
`run()`. Type aliases are allowed (they compile away) but top-level `const`
schemas are not, which is a subtle line.

**Suggested fix:** one line in the docs — "module top-level may only contain the
default export / `meta`; put schemas and helpers inside `run()`."

## Smaller things

- **Bin name mismatch.** The npm bin is `defineworkflow`, but the README
  quick-start says `workflow run haiku.workflow.ts`. A fresh user copy-pastes
  that and gets command-not-found. Pick one name in the docs.
- **Stated Node/pnpm floor vs. reality.** README says Node ≥20 / pnpm ≥11, but
  the published package installed fine under pnpm 10. Worth reconciling so the
  stated floor is the real floor.
- **esbuild postinstall + pnpm `onlyBuiltDependencies`.** esbuild's binary won't
  download until the build script is approved (`pnpm approve-builds` /
  `onlyBuiltDependencies`). A note in the install section would smooth first-run.

## What's genuinely good

- **`--mock` is excellent.** Exercising all phases, schema validation, and the
  Ralph stopping condition with zero tokens made building fast and cheap.
- **`schema`-returns-typed-object ergonomics are clean**, and `parallel()` /
  `pipeline()` read well.
- **The phase/agent TUI summary** is a nice payoff at the end of a run.
- **The durability core** (journal by sequence number + `resume`) is the right
  idea, and it's well separated from the authoring shell.

Most of my friction was the thin authoring-transform shell around an otherwise
solid core — exactly the layer that's easiest to polish.
