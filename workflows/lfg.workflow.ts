// lfg.workflow.ts — the lfg autopilot pipeline as a defineWorkflow workflow.
//
// This is the same pipeline the `lfg` skill bundles as ~35k tokens of reference
// prose, but expressed as deterministic, journaled control flow. The technique
// guidance lives in each agent's prompt instead of one giant context window, so
// every step is a *fresh* coding-agent invocation that only sees what it needs.
//
// Run it:
//   defineworkflow run lfg.workflow.ts --mock                         # iterate on control flow, no tokens
//   defineworkflow run lfg.workflow.ts --args '{"feature":"add X"}'   # real agents
//
// Note: the Implement step is SEQUENTIAL, not pipeline()/parallel() — every task
// mutates the same working tree, so concurrent implementers would corrupt repo
// state. Correctness over parallelism here.

import { agent, args, defineWorkflow, log, phase, z } from "defineworkflow";

export default defineWorkflow({
  name: "lfg",
  description:
    "Autonomous engineering autopilot: recall, specify, plan, implement (TDD), review, verify, ship, watch CI, compound",
  harness: "claude",
  phases: [
    { title: "Isolate", detail: "create worktree/branch" },
    { title: "Recall", detail: "search docs/solutions" },
    { title: "Specify", detail: "write spec: assumptions + testable success criteria" },
    { title: "Plan", detail: "write implementation plan from spec" },
    { title: "Implement", detail: "per-task TDD + review" },
    { title: "Review", detail: "whole-diff review + autofix" },
    { title: "Verify", detail: "tests + build green" },
    { title: "Ship", detail: "push + open PR" },
    { title: "CI", detail: "watch + autofix (max 3)" },
    { title: "Compound", detail: "document the learning" },
  ],
  async run() {
    // ----- schemas (MUST be declared inside run()) -----
    const Isolation = z.object({
      branch: z.string().describe("the feature branch now checked out"),
      isolated: z
        .boolean()
        .describe("true if on a dedicated branch/worktree, not main/master"),
    });

    const Recall = z.object({
      learnings: z
        .array(z.string())
        .describe("prevention/guidance bullets from docs/solutions; empty if none"),
    });

    const Spec = z.object({
      specPath: z.string().describe("path to the written spec file"),
      assumptions: z
        .array(z.string())
        .describe("assumptions being proceeded on (recorded for human audit on the PR)"),
      successCriteria: z
        .array(z.string())
        .min(1)
        .describe("specific, testable conditions that define 'done' — the contract Verify checks"),
      openQuestions: z
        .array(z.string())
        .describe("unresolved questions + the interpretation chosen for each; empty if none"),
    });

    const Task = z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().describe("full task text the implementer needs"),
    });

    const Plan = z.object({
      planPath: z.string().describe("path to the written plan file"),
      tasks: z.array(Task).min(1),
    });

    const TaskReport = z.object({
      status: z.enum(["DONE", "DONE_WITH_CONCERNS", "BLOCKED"]),
      compliant: z.boolean().describe("does the committed code match the task spec"),
      issues: z.array(z.string()).describe("file:line issues; empty if clean"),
      summary: z.string(),
    });

    const Verify = z.object({
      green: z.boolean(),
      summary: z.string(),
      failures: z.array(z.string()),
    });

    const Ship = z.object({
      branch: z.string(),
      pushed: z.boolean(),
      prUrl: z.string().optional(),
    });

    const Ci = z.object({
      green: z.boolean(),
      failingChecks: z.array(z.string()),
      summary: z.string(),
    });

    const Compound = z.object({
      status: z.enum(["complete", "skipped"]),
      docPath: z.string().optional(),
      reason: z.string().optional(),
    });

    type Report = z.infer<typeof TaskReport>;

    // ----- args (args is `unknown` — cast once) -----
    const { feature } = (args ?? {}) as { feature?: string };
    if (!feature) {
      throw new Error(
        'lfg requires a feature description: --args \'{"feature":"..."}\'',
      );
    }

    // ===== Step 0 — Isolate =====
    phase("Isolate");
    const iso = await agent(
      `You are Step 0 (Isolate) of an autonomous engineering pipeline for this feature:
"${feature}"

Create an isolated workspace: prefer a native worktree tool, else \`git worktree add\`, else a fresh feature branch. NEVER work on main/master. Install deps and confirm a clean test baseline. Return the branch name and whether isolation succeeded.`,
      { label: "isolate", phase: "Isolate", schema: Isolation },
    );
    log(`branch: ${iso.branch} (isolated=${iso.isolated})`);

    // ===== Step 1 — Recall =====
    phase("Recall");
    const recall = await agent(
      `You are Step 1 (Recall) for: "${feature}".

Search docs/solutions/ for prior learnings relevant to this feature (grep keywords from the description — module names, error terms, component types). Read the frontmatter of strong matches, then the closest 1-3 fully, and extract their Prevention / Guidance / What-Didn't-Work bullets. If docs/solutions/ doesn't exist, return an empty list.`,
      { label: "recall", phase: "Recall", schema: Recall },
    );

    // ===== Step 2 — Specify (lock down "done" before any plan or code) =====
    phase("Specify");
    const learningsBlock = recall.learnings.length
      ? `Prior learnings to honor:\n${recall.learnings.map((l) => `- ${l}`).join("\n")}`
      : "No prior learnings found.";
    const spec = await agent(
      `You are Step 2 (Specify) for: "${feature}".
${learningsBlock}

Write a structured specification BEFORE any plan or code — the spec is the source of truth for what "done" means. This pipeline runs hands-off, so the spec workflow's human-review gate becomes self-review plus a recorded assumption trail: surface your assumptions in writing and PROCEED on them (never block waiting for an answer).

Read the repo first (don't invent the tech stack or commands). Then write a spec to docs/specs/<feature-slug>.md covering:
- **Objective** — what we're building and why; who the user is; what success looks like.
- **Assumptions** — every assumption you're proceeding on (e.g. framework, auth model, datastore), inferred from the codebase. These are recorded for human audit on the PR.
- **Tech Stack** — framework/language/key deps WITH versions, read from the repo.
- **Commands** — full executable build / test / lint / dev commands (with flags), from the repo.
- **Project Structure** — where source, tests, and docs for this change live.
- **Testing Strategy** — framework, where tests live, which levels (unit/integration/e2e) cover which concerns.
- **Success Criteria** — reframe every vague requirement into SPECIFIC, TESTABLE conditions (numbers, observable behaviors, commands that must pass). This is the contract the Verify step checks against. If a requirement can't be reframed into something checkable, record it under Open Questions.
- **Boundaries** — Always (run tests before commit, follow existing naming, validate inputs); Record-and-proceed (schema changes, new deps, CI-config changes — only if the task plainly needs them, noted on the PR); Never (commit secrets, edit vendored dirs, weaken/skip/delete a failing test to pass).
- **Open Questions** — anything unresolved, each WITH the interpretation you chose and are proceeding on.

Self-review before returning: is every vague requirement now a testable success criterion? Are assumptions written down, not silent? Then return the spec file path, the assumptions, the success criteria, and the open questions.`,
      { label: "specify", phase: "Specify", schema: Spec },
    );
    log(`spec: ${spec.specPath} (${spec.successCriteria.length} success criteria)`);

    const specBlock = [
      `Spec: ${spec.specPath} — read it in full before starting.`,
      `Success criteria (the definition of done):\n${spec.successCriteria.map((c) => `- ${c}`).join("\n")}`,
      spec.assumptions.length
        ? `Assumptions in force:\n${spec.assumptions.map((a) => `- ${a}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    // ===== Step 3 — Plan =====
    phase("Plan");
    const plan = await agent(
      `You are Step 3 (Plan) for: "${feature}".
${learningsBlock}

${specBlock}

Turn the validated spec into a comprehensive implementation plan at docs/superpowers/plans/<feature-slug>.md: bite-sized TDD steps, exact file paths, COMPLETE code in each step, DRY/YAGNI, frequent commits, no placeholders or TODOs. Every success criterion in the spec MUST map to at least one task — do not plan work the spec doesn't call for (YAGNI), and do not leave a success criterion unaddressed. Decompose into ordered, self-contained tasks. Return the plan file path and the task list (each task's full text in 'description').`,
      { label: "plan", phase: "Plan", schema: Plan },
    );
    log(`plan: ${plan.planPath} (${plan.tasks.length} tasks)`);

    // ===== Step 4 — Implement (sequential; shared working tree) =====
    phase("Implement");
    const reports: { id: string; name: string; report: Report }[] = [];
    for (let i = 0; i < plan.tasks.length; i++) {
      const task = plan.tasks[i]; // noUncheckedIndexedAccess → guard below
      if (!task) continue;
      log(`task ${i + 1}/${plan.tasks.length}: ${task.name}`);

      await agent(
        `You are the IMPLEMENTER for Task ${task.id}: ${task.name}
Plan: ${plan.planPath}

## Task
${task.description}

Implement with strict TDD: write the failing test, watch it fail, write minimal code to pass, refactor. Follow existing codebase patterns. Build only what the task specifies (YAGNI). Commit when green.`,
        { label: `impl:${task.id}`, phase: "Implement" },
      );

      // Spec + quality review with ONE bounded fix attempt.
      let report = await agent(
        `You are the REVIEWER for Task ${task.id}: ${task.name}
Plan: ${plan.planPath}

## Task spec
${task.description}

Do NOT trust any prior report — read the actual committed code (git diff for this task). Verify it matches the spec (nothing missing, nothing extra) AND is well-built (clean, tested against real behavior, one responsibility per file). Return status, compliant, issues (file:line), summary.`,
        { label: `review:${task.id}`, phase: "Implement", schema: TaskReport },
      );

      if (!report.compliant && report.issues.length > 0) {
        await agent(
          `You are the IMPLEMENTER fixing review issues for Task ${task.id}.
Plan: ${plan.planPath}

## Issues
${report.issues.map((x) => `- ${x}`).join("\n")}

Fix the root cause of each (TDD where behavior changes), keep all tests green, commit.`,
          { label: `fix:${task.id}`, phase: "Implement" },
        );
        report = await agent(
          `Re-review Task ${task.id} after fixes. Read the actual code, don't trust the fix report. Return status, compliant, issues, summary.`,
          { label: `re-review:${task.id}`, phase: "Implement", schema: TaskReport },
        );
      }
      reports.push({ id: task.id, name: task.name, report });
    }

    // ===== Step 5 — Whole-diff review + autofix =====
    phase("Review");
    await agent(
      `You are Step 5 (whole-diff Review) for: "${feature}".
Plan: ${plan.planPath}

${specBlock}

Review the full branch diff against the spec and plan: does it satisfy every success criterion (nothing missing, nothing extra beyond the spec)? Also check correctness, architecture, error handling, tests verifying real behavior, and edge cases. Apply the valid fixes with technical rigor (verify each suggestion — don't blindly agree). Commit as \`fix(review): apply code review feedback\`. If a finding can't be auto-resolved, note it for the PR body.`,
      { label: "diff-review", phase: "Review" },
    );

    // ===== Step 6 — Verify (evidence before claims) with bounded debug loop =====
    phase("Verify");
    let verify = await agent(
      `You are Step 6 (Verify) for: "${feature}".

${specBlock}

Verify the work against the spec's success criteria — each one is a checkable condition, so check it. Run the project's test suite AND the build, and exercise the app (start the dev server / run the CLI) if there's a runnable surface. Report ACTUAL command output — never claim green without running it. Treat a success criterion you cannot demonstrate as a failure. Return green (true only if every success criterion holds and tests+build pass), a summary, and any failures.`,
      { label: "verify", phase: "Verify", schema: Verify },
    );
    let debugTries = 0;
    while (!verify.green && debugTries < 3) {
      debugTries++;
      log(`verify red — debug attempt ${debugTries}/3`);
      await agent(
        `Systematic debugging — Step 5 verification failed for "${feature}".

## Failures
${verify.failures.map((x) => `- ${x}`).join("\n")}

Find the ROOT CAUSE before fixing — no symptom patches, no weakening or skipping tests. Fix, keep a regression test, commit.`,
        { label: `debug:${debugTries}`, phase: "Verify" },
      );
      verify = await agent(
        `Re-run the full test suite and build for "${feature}". Report actual output. Return green, summary, failures.`,
        { label: `verify:${debugTries}`, phase: "Verify", schema: Verify },
      );
    }

    // ===== Step 7 — Ship =====
    phase("Ship");
    const assumptionsForPr = spec.assumptions.length
      ? `Recorded assumptions to surface in the PR body (so a human can audit them):\n${spec.assumptions.map((a) => `- ${a}`).join("\n")}`
      : "No assumptions were recorded.";
    const openQuestionsForPr = spec.openQuestions.length
      ? `Open questions + chosen interpretations to surface in the PR body:\n${spec.openQuestions.map((q) => `- ${q}`).join("\n")}`
      : "";
    const ship = await agent(
      `You are Step 7 (Ship) for: "${feature}" on branch ${iso.branch}.
Spec: ${spec.specPath}

${assumptionsForPr}

${openQuestionsForPr}

Commit any remaining changes (including the spec file), push the branch, and open a PR (\`gh pr create\`) with a Summary, a Test Plan, a link to the spec (${spec.specPath}), and an "## Assumptions & Open Questions" section listing the recorded assumptions and chosen interpretations above so a human can audit the autonomous calls. If there's no remote or gh is unavailable, just push the branch. Return branch, pushed, and prUrl if a PR was opened.`,
      { label: "ship", phase: "Ship", schema: Ship },
    );
    log(ship.prUrl ? `PR: ${ship.prUrl}` : `pushed branch ${ship.branch}`);

    // ===== Step 8 — CI watch + autofix (max 3 cycles; only if a PR exists) =====
    phase("CI");
    let ci: z.infer<typeof Ci> = {
      green: true,
      failingChecks: [],
      summary: "skipped (no PR)",
    };
    if (ship.prUrl) {
      ci = await agent(
        `You are Step 8 (CI watch) for PR ${ship.prUrl}. Check pipeline status (\`gh pr checks\` / \`gh run view\`). Return green, failingChecks, summary.`,
        { label: "ci", phase: "CI", schema: Ci },
      );
      let ciTries = 0;
      while (!ci.green && ciTries < 3) {
        ciTries++;
        log(`CI red — fix cycle ${ciTries}/3`);
        await agent(
          `CI is failing on PR ${ship.prUrl}.

## Failing checks
${ci.failingChecks.map((x) => `- ${x}`).join("\n")}

Read the failed logs, fix the REAL cause (NEVER skip/weaken/mock an assertion to make it pass), commit and push.`,
          { label: `ci-fix:${ciTries}`, phase: "CI" },
        );
        ci = await agent(
          `Re-check CI for PR ${ship.prUrl} after pushing fixes. Return green, failingChecks, summary.`,
          { label: `ci:${ciTries}`, phase: "CI", schema: Ci },
        );
      }
      if (!ci.green) {
        await agent(
          `CI is still red after 3 fix cycles on PR ${ship.prUrl}. Append a "## CI Failures Unresolved" section to the PR body listing each failing check + a one-line summary + the run URL. Do not weaken any test.`,
          { label: "ci-residual", phase: "CI" },
        );
      }
    }

    // ===== Step 9 — Compound (write side of the loop) =====
    phase("Compound");
    const compound = await agent(
      `You are Step 9 (Compound) for: "${feature}".
Spec: ${spec.specPath}
Document what was built/solved into docs/solutions/<category>/<slug>.md with YAML frontmatter (title, date, track, category, problem_type, tags). Dedupe against existing docs (update on high overlap rather than duplicate). Ensure CLAUDE.md/AGENTS.md surfaces the store. If the work was too trivial to document, skip with a reason. Return status (complete|skipped), docPath, reason.`,
      { label: "compound", phase: "Compound", schema: Compound },
    );

    // ===== Step 10 — DONE =====
    return {
      feature,
      specPath: spec.specPath,
      branch: ship.branch,
      prUrl: ship.prUrl ?? null,
      tasks: reports.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.report.status,
        compliant: r.report.compliant,
      })),
      verified: verify.green,
      ci: ci.green ? "green" : `red: ${ci.failingChecks.join(", ")}`,
      learning:
        compound.status === "complete"
          ? (compound.docPath ?? "documented")
          : `skipped: ${compound.reason ?? "trivial"}`,
    };
  },
});
