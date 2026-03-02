import { handleAmendSubcommand } from "../orchestrate-amend-command.js";
import { handleIntakeSubcommand } from "../orchestrate-intake-command.js";
import { describe, expect, it, vi } from "vitest";

describe("legacy orchestrate command handlers", () => {
  it("redirects intake into the active session draft", async () => {
    let writtenSummary = "";
    const emitEvent = vi.fn(async () => {});

    const text = await handleIntakeSubcommand({
      payload: "Build websocket tool with tests",
      ctx: {
        channel: "cli",
        senderId: "tester",
        sessionKey: "sess_fallback",
        commandTargetSessionKey: "sess_target",
      },
      readOrchestrateSession: vi.fn(async () => null),
      writeOrchestrateSession: vi.fn(async (next) => {
        writtenSummary = next.draft.task_goal;
      }),
      emitEvent,
      renderOrchestrateHelp: () => "help text",
    });

    expect(writtenSummary).toContain("Build websocket tool");
    expect(text).toContain("legacy helper");
    expect(text).toContain("sess_target");
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });

  it("persists amendments through the handler", async () => {
    const writes: Array<{ path: string; payload: string }> = [];
    const emitEvent = vi.fn(async () => {});

    const text = await handleAmendSubcommand({
      payload: "task_demo add websocket smoke test",
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      io: {
        fileExists: vi.fn(async (targetPath: string) => targetPath.endsWith("/meta.json")),
        readText: vi.fn(async () => ""),
        writeTextAtomic: vi.fn(async (targetPath: string, payload: string) => {
          writes.push({ path: targetPath, payload });
        }),
      },
      runWhitelistedScript: vi.fn(async () => ({ stdout: "", stderr: "" })),
      emitEvent,
    });

    expect(text).toContain("amendment accepted");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/repo/tasks/task_demo/amendments.md");
    expect(writes[0]?.payload).toContain("# Amendments");
    expect(writes[0]?.payload).toContain("add websocket smoke test");
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });
});
