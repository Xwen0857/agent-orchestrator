import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_BASE_PATH,
  DEFAULT_BASE_PATH,
  DEFAULT_REPO_ROOT,
  configSchema,
  parsePluginConfig,
} from "../orchestrate-plugin-config.js";

describe("orchestrate-plugin-config", () => {
  it("parses defaults and keeps fallback values", () => {
    const cfg = parsePluginConfig({});
    expect(cfg.repoRoot).toBe(DEFAULT_REPO_ROOT);
    expect(cfg.basePath).toBe(DEFAULT_BASE_PATH);
    expect(cfg.apiBasePath).toBe(DEFAULT_API_BASE_PATH);
    expect(cfg.runnerExecutionMode).toBe("local_threads");
    expect(cfg.runnerIntervalSec).toBe(10);
  });

  it("normalizes incoming values through config schema", () => {
    const parsed = configSchema.safeParse({
      basePath: "plugins/custom",
      apiBasePath: "api/custom",
      runnerExecutionMode: "distributed",
      runnerFallbackMode: "none",
      runnerBatchSize: 7,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data.basePath).toBe("/plugins/custom");
    expect(parsed.data.apiBasePath).toBe("/api/custom");
    expect(parsed.data.runnerExecutionMode).toBe("distributed");
    expect(parsed.data.runnerFallbackMode).toBe("none");
    expect(parsed.data.runnerBatchSize).toBe(7);
  });
});
