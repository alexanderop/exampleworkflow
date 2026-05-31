// Prompt builders for the AFK pipeline.
//
// Pulling the long prompt strings out of the orchestrator keeps
// `afk-pipeline.workflow.ts` readable — the main file reads as control flow,
// these functions hold the wording. They're pure (string in → string out),
// so they stay deterministic and journal-replay-safe.
import type { Slice } from "./schemas";

/** Phase 2 — slice the PRD into vertical, independently-shippable slices. */
export const slicerPrompt = (prdPath: string): string =>
  [
    `Read the PRD at ${prdPath}.`,
    `Break it into VERTICAL slices. Each slice must be end-to-end (UI + API + test)`,
    `and independently shippable — a horizontal "frontend task / backend task / tests`,
    `task" split is wrong. Each slice should be a 1–2 pointer that one agent can finish`,
    `in one go. For each slice give an id, title, one-line summary, and the task`,
    `checklist (UI + API + test).`,
  ].join("\n");

/** Phase 3 — one fresh-context Ralph iteration over a single slice's checklist. */
export const ralphPrompt = (slice: Slice): string =>
  [
    `You are working on ONE vertical slice in its own git worktree: "${slice.title}".`,
    `Slice goal: ${slice.summary}`,
    ``,
    `Checklist for this slice:`,
    ...slice.tasks.map((t) => `- [ ] ${t}`),
    ``,
    `Pick the single highest-priority UNCHECKED task and do it with strict TDD:`,
    `  1. red:      write a failing test that asserts the behaviour`,
    `  2. green:    write the minimum code to pass it`,
    `  3. refactor: clean up; tests must stay green`,
    `  4. commit`,
    `Do NOT delete or weaken a failing test to make it pass.`,
    `Report the task you finished, how many tasks remain, whether tests`,
    `are green, and your commit message.`,
  ].join("\n");

/** Phase 4 — the dedicated /simplify pass the implementation loop skips. */
export const refactorPrompt = (): string =>
  [
    `Run on the current branch with ALL slices merged. Tests must stay green throughout.`,
    `For each of: duplication, long files, primitive obsession, dead code, and inconsistent`,
    `naming — find one offender, fix it, run tests, commit. Repeat until you can't find more.`,
    `Do NOT change behaviour. Do NOT add features. This is the cleanup the loop skipped.`,
  ].join("\n");

/** Phase 5 — agentic QA driving the real browser through happy + negative paths. */
export const qaPrompt = (appUrl: string): string =>
  [
    `You are a QA engineer. The app under test is at ${appUrl}.`,
    `Use agent-browser to drive the real UI.`,
    `Run the happy path end-to-end with valid data, then at least two negative paths`,
    `(invalid input, and a downstream failure such as a declined payment).`,
    `Take a screenshot at every state. Write a markdown report to qa/ with one section`,
    `per test case: steps taken, expected, actual, pass/fail, and the screenshot path.`,
    `Return the structured result with your ship recommendation.`,
  ].join("\n");
