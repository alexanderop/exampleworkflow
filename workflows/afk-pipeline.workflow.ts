import { agent, args, defineWorkflow, log, parallel, phase } from "defineworkflow";
import {
  ArgsSchema,
  QaReportSchema,
  RalphIterationSchema,
  SlicesSchema,
  type RalphIteration,
  type Slice,
} from "./afk-pipeline/schemas";
import {
  qaPrompt,
  ralphPrompt,
  refactorPrompt,
  slicerPrompt,
} from "./afk-pipeline/prompts";

/**
 * AFK coding pipeline — the "HITL at the edges, AFK in the middle" workflow.
 *
 * You do Phase 1 (align on the spec) and Phase 6 (review the PR) by hand.
 * This workflow runs the four AFK phases in between:
 *
 *   2. Slice        the PRD into vertical, independently-shippable slices
 *   3. Ralph loop   one fresh-context agent per slice, TDD red-green-refactor
 *   4. Refactor     the dedicated /simplify pass the implementation loop skips
 *   5. Agentic QA   drive the real browser through happy + negative paths
 *
 * Input (via --args): { "prd": "docs/prd-booking-wizard.md", "appUrl": "http://localhost:3000" }
 *
 * Iterate on control flow with zero tokens:
 *   pnpm afk:mock --args '{"prd":"docs/prd-booking-wizard.md"}'
 * Run for real:
 *   pnpm afk --args '{"prd":"docs/prd-booking-wizard.md","appUrl":"http://localhost:3000/book"}'
 *
 * defineworkflow >= 0.5.0 bundles relative imports, so the schemas and prompts
 * live in `./afk-pipeline/{schemas,prompts}.ts` and this file stays control-flow.
 * Runtime primitives can be imported from "defineworkflow" (as below) or
 * destructured from run()'s context — both resolve to the same injected runtime.
 * We import them because the importable stubs carry the schema-generic overload
 * that infers `agent({ schema })`'s return type; the context-injected ones don't.
 */

// How many fresh-context Ralph iterations a single slice is allowed.
const MAX_RALPH_ITERATIONS = 5;

export default defineWorkflow({
  name: "afk-pipeline",
  description:
    "AFK coding pipeline: slice a PRD into vertical slices, Ralph-loop each with TDD, refactor, then agentic QA",
  harness: "claude",
  phases: [
    { title: "Slice", detail: "PRD → vertical, independently-shippable slices" },
    { title: "Ralph loop", detail: "one fresh-context TDD agent per slice" },
    { title: "Refactor", detail: "the dedicated /simplify pass the loop skips" },
    { title: "QA", detail: "agent-browser drives the real UI" },
  ],

  async run() {
    // ── Phase 3 helper: the Ralph loop for one slice ─────────────────────────
    // A fresh-context agent invocation per iteration (mirrors
    // `while :; do cat PROMPT.md | claude; done`), each doing red-green-refactor
    // on the next unchecked task until the checklist is empty.
    const ralphLoop = async (slice: Slice, index: number) => {
      const iterations: RalphIteration[] = [];

      for (let i = 0; i < MAX_RALPH_ITERATIONS; i++) {
        const result = await agent(ralphPrompt(slice), {
          label: `ralph:${slice.id}#${i + 1}`,
          phase: "Ralph loop",
          schema: RalphIterationSchema,
        });

        iterations.push(result);
        log(`[${slice.id}] ${result.commit} — ${result.remaining} task(s) left`);

        // Stopping condition, like Ralph's `grep -q "^- \[ \]" PROMPT.md || break`.
        if (result.remaining <= 0) break;
      }

      return { slice: slice.id, index, iterations };
    };

    // ── Read inputs ──────────────────────────────────────────────────────────
    const parsedArgs = ArgsSchema.safeParse(args);
    const { prd: prdPath, appUrl } = parsedArgs.success
      ? parsedArgs.data
      : ArgsSchema.parse({});

    // ── Phase 2: slice the ticket ────────────────────────────────────────────
    phase("Slice");
    log(`reading PRD from ${prdPath} and slicing it vertically…`);

    const { slices } = await agent(slicerPrompt(prdPath), {
      label: "slicer",
      phase: "Slice",
      schema: SlicesSchema,
    });

    log(
      `${slices.length} vertical slice(s): ${slices.map((s) => s.id).join(", ")}`,
    );

    // ── Phase 3: Ralph loop per slice (barrier — every slice ships before refactor) ──
    phase("Ralph loop");
    const implemented = await parallel(
      slices.map((slice, i) => () => ralphLoop(slice, i)),
    );

    const completed = implemented.filter(Boolean);
    log(
      `${completed.length}/${slices.length} slice(s) completed their Ralph loop`,
    );

    // ── Phase 4: the dedicated refactor pass ─────────────────────────────────
    phase("Refactor");
    const refactor = await agent(refactorPrompt(), {
      label: "simplify",
      phase: "Refactor",
    });

    // ── Phase 5: agentic QA in a real browser ────────────────────────────────
    phase("QA");
    log(`driving the real UI at ${appUrl} with agent-browser…`);
    const qa = await agent(qaPrompt(appUrl), {
      label: "qa-browser",
      phase: "QA",
      schema: QaReportSchema,
    });

    // ── Hand back to the human for Phase 6 (review + UAT) ─────────────────────
    return {
      prd: prdPath,
      slices: slices.map((s) => ({ id: s.id, title: s.title })),
      ralph: completed,
      refactor,
      qa,
      nextStep:
        "Phase 6 (HITL): review the diff + test names, run it locally, send the preview URL for UAT.",
    };
  },
});
