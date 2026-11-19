/** fast-check run count: 200 locally, raised in CI via FC_NUM_RUNS. */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
export const RUNS = Number(env.FC_NUM_RUNS ?? 200);
