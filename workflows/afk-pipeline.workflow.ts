import { agent, args, defineWorkflow, log, parallel, phase, z } from "defineworkflow";

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
 * NOTE: the engine requires the default-exported workflow to be the FIRST
 * statement, so all schemas and helpers live inside run().
 */
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
    // How many fresh-context Ralph iterations a single slice is allowed.
    const MAX_RALPH_ITERATIONS = 5;

    // ── Inputs (via --args) ────────────────────────────────────────────────────
    const ArgsSchema = z.object({
      prd: z.string().default("docs/prd-booking-wizard.md"),
      appUrl: z.string().default("http://localhost:3000"),
    });

    // ── Structured outputs ─────────────────────────────────────────────────────
    const SliceSchema = z.object({
      id: z.string().describe("kebab-case slice id, e.g. 'step-1-guest-info'"),
      title: z.string(),
      summary: z
        .string()
        .describe("one-line description of the end-to-end behaviour"),
      tasks: z
        .array(z.string())
        .describe("the checklist the Ralph loop ticks off, UI + API + test"),
    });

    const SlicesSchema = z.object({
      slices: z
        .array(SliceSchema)
        .describe(
          "vertical slices: each must be UI + API + test and independently shippable",
        ),
    });

    const RalphIterationSchema = z.object({
      taskDone: z.string().describe("the single task implemented this iteration"),
      remaining: z
        .number()
        .int()
        .describe("count of still-unchecked tasks in this slice"),
      testsGreen: z.boolean().describe("did the red-green-refactor cycle end green"),
      commit: z.string().describe("the commit message used"),
    });

    const QaReportSchema = z.object({
      cases: z.array(
        z.object({
          name: z.string(),
          kind: z.enum(["happy", "negative"]),
          pass: z.boolean(),
          notes: z.string(),
        }),
      ),
      shipRecommendation: z.enum(["ship", "hold"]),
      reportPath: z
        .string()
        .describe("path to the markdown report written to qa/"),
    });

    type Slice = z.infer<typeof SliceSchema>;

    // ── Phase 3 helper: the Ralph loop for one slice ───────────────────────────
    // A fresh-context agent invocation per iteration (mirrors
    // `while :; do cat PROMPT.md | claude; done`), each doing red-green-refactor
    // on the next unchecked task until the checklist is empty.
    const ralphLoop = async (slice: Slice, index: number) => {
      const iterations: z.infer<typeof RalphIterationSchema>[] = [];

      for (let i = 0; i < MAX_RALPH_ITERATIONS; i++) {
        const result = await agent(
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
          ].join("\n"),
          {
            label: `ralph:${slice.id}#${i + 1}`,
            phase: "Ralph loop",
            schema: RalphIterationSchema,
          },
        );

        iterations.push(result);
        log(`[${slice.id}] ${result.commit} — ${result.remaining} task(s) left`);

        // Stopping condition, like Ralph's `grep -q "^- \[ \]" PROMPT.md || break`.
        if (result.remaining <= 0) break;
      }

      return { slice: slice.id, index, iterations };
    };

    // ── Read inputs ────────────────────────────────────────────────────────────
    const parsedArgs = ArgsSchema.safeParse(args);
    const { prd: prdPath, appUrl } = parsedArgs.success
      ? parsedArgs.data
      : ArgsSchema.parse({});

    // ── Phase 2: slice the ticket ──────────────────────────────────────────────
    phase("Slice");
    log(`reading PRD from ${prdPath} and slicing it vertically…`);

    const { slices } = await agent(
      [
        `Read the PRD at ${prdPath}.`,
        `Break it into VERTICAL slices. Each slice must be end-to-end (UI + API + test)`,
        `and independently shippable — a horizontal "frontend task / backend task / tests`,
        `task" split is wrong. Each slice should be a 1–2 pointer that one agent can finish`,
        `in one go. For each slice give an id, title, one-line summary, and the task`,
        `checklist (UI + API + test).`,
      ].join("\n"),
      { label: "slicer", phase: "Slice", schema: SlicesSchema },
    );

    log(
      `${slices.length} vertical slice(s): ${slices.map((s) => s.id).join(", ")}`,
    );

    // ── Phase 3: Ralph loop per slice (barrier — every slice ships before refactor) ──
    phase("Ralph loop");
    const implemented = await parallel(
      slices.map((slice, i) => () => ralphLoop(slice, i)),
    );

    const completed = implemented.filter(Boolean);
    log(`${completed.length}/${slices.length} slice(s) completed their Ralph loop`);

    // ── Phase 4: the dedicated refactor pass ───────────────────────────────────
    phase("Refactor");
    const refactor = await agent(
      [
        `Run on the current branch with ALL slices merged. Tests must stay green throughout.`,
        `For each of: duplication, long files, primitive obsession, dead code, and inconsistent`,
        `naming — find one offender, fix it, run tests, commit. Repeat until you can't find more.`,
        `Do NOT change behaviour. Do NOT add features. This is the cleanup the loop skipped.`,
      ].join("\n"),
      { label: "simplify", phase: "Refactor" },
    );

    // ── Phase 5: agentic QA in a real browser ──────────────────────────────────
    phase("QA");
    log(`driving the real UI at ${appUrl} with agent-browser…`);
    const qa = await agent(
      [
        `You are a QA engineer. The app under test is at ${appUrl}.`,
        `Use agent-browser to drive the real UI.`,
        `Run the happy path end-to-end with valid data, then at least two negative paths`,
        `(invalid input, and a downstream failure such as a declined payment).`,
        `Take a screenshot at every state. Write a markdown report to qa/ with one section`,
        `per test case: steps taken, expected, actual, pass/fail, and the screenshot path.`,
        `Return the structured result with your ship recommendation.`,
      ].join("\n"),
      { label: "qa-browser", phase: "QA", schema: QaReportSchema },
    );

    // ── Hand back to the human for Phase 6 (review + UAT) ───────────────────────
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
