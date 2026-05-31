// Schemas + inferred types for the AFK pipeline.
//
// In defineworkflow >= 0.5.0 the runner bundles relative imports (esbuild
// `bundle: true` + a local-only resolver plugin), so schemas and prompts can
// live in their own files and get inlined into the workflow before it runs.
// Import `z` from "defineworkflow" (NOT "zod"): the engine keeps that import
// external and injects its own zod instance into the sandbox.
import { z } from "defineworkflow";

// ── Inputs (via --args) ──────────────────────────────────────────────────────
export const ArgsSchema = z.object({
  prd: z.string().default("docs/prd-booking-wizard.md"),
  appUrl: z.string().default("http://localhost:3000"),
});

// ── Phase 2: a vertical slice of the PRD ─────────────────────────────────────
export const SliceSchema = z.object({
  id: z.string().describe("kebab-case slice id, e.g. 'step-1-guest-info'"),
  title: z.string(),
  summary: z
    .string()
    .describe("one-line description of the end-to-end behaviour"),
  tasks: z
    .array(z.string())
    .describe("the checklist the Ralph loop ticks off, UI + API + test"),
});

export const SlicesSchema = z.object({
  slices: z
    .array(SliceSchema)
    .describe(
      "vertical slices: each must be UI + API + test and independently shippable",
    ),
});

// ── Phase 3: one fresh-context Ralph iteration ───────────────────────────────
export const RalphIterationSchema = z.object({
  taskDone: z.string().describe("the single task implemented this iteration"),
  remaining: z
    .number()
    .int()
    .describe("count of still-unchecked tasks in this slice"),
  testsGreen: z
    .boolean()
    .describe("did the red-green-refactor cycle end green"),
  commit: z.string().describe("the commit message used"),
});

// ── Phase 5: the agentic QA report ───────────────────────────────────────────
export const QaReportSchema = z.object({
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

export type Slice = z.infer<typeof SliceSchema>;
export type RalphIteration = z.infer<typeof RalphIterationSchema>;
