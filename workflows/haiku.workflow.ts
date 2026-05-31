import { agent, defineWorkflow, log, phase } from "defineworkflow";

/**
 * Smoke test. Run it with no tokens spent:
 *   pnpm haiku:mock
 * …or for real against the Claude CLI:
 *   pnpm haiku
 */
export default defineWorkflow({
  name: "haiku",
  description: "Ask an agent to write a haiku about durable workflows",
  harness: "claude",
  phases: [{ title: "Write" }],

  async run() {
    phase("Write");
    log("asking the agent for a haiku…");

    const poem = await agent(
      "Write a haiku about durable, crash-safe workflows. Return only the haiku.",
      { label: "haiku-writer", phase: "Write" },
    );

    return { poem };
  },
});
