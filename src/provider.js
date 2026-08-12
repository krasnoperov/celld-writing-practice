import { createDemoProvider } from "./providers/demo.js";
import { createOpenAIProvider } from "./providers/openai.js";

export function createCoachProvider(env = {}) {
  const name = env.COACH_PROVIDER || "demo";
  if (name === "demo") return createDemoProvider();
  if (name === "openai") return createOpenAIProvider(env);
  throw new Error(`Unknown COACH_PROVIDER: ${name}`);
}
