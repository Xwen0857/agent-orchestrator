import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import plugin from "../index.js";
import { describe, expect, it } from "vitest";
import { createMockCommandContext, createMockPluginApi } from "./helpers/mock-plugin-api.js";

describe("orchestrator-dashboard session commands", () => {
  it("rejects free-text run payloads in session mode", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-plugin-"));
    const { api, getRegisteredCommand } = createMockPluginApi({
      enabled: true,
      repoRoot,
      runtimeConsistencyMode: "warn",
    });

    plugin.register?.(api);

    const registeredCommand = getRegisteredCommand();
    const result = await registeredCommand.handler(
      createMockCommandContext({
        args: "run build a calculator",
      }),
    );

    expect(result.text).toContain("usage: /orchestrate run");
    expect(result.text).toContain("run no longer accepts free text");
  });

  it("fails run when no summary exists for the current session", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-plugin-"));
    const { api, getRegisteredCommand } = createMockPluginApi({
      enabled: true,
      repoRoot,
      runtimeConsistencyMode: "warn",
    });

    plugin.register?.(api);

    const registeredCommand = getRegisteredCommand();
    const result = await registeredCommand.handler(
      createMockCommandContext({
        args: "run",
        sessionKey: "test-session-no-summary",
        messageThreadId: 2,
      }),
    );

    expect(result.text).toContain("code: ORCHESTRATE_SUMMARY_NOT_FOUND");
    expect(result.text).toContain("run /orchestrate summary first");
  });
});
