import { handleResumeSubcommand } from "../orchestrate-resume-command.js";
import { describe, expect, it, vi } from "vitest";

describe("orchestrate resume command", () => {
  it("validates payload and triggers the hard replan resume script", async () => {
    const emitEvent = vi.fn(async () => {});
    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));

    const text = await handleResumeSubcommand({
      payload: "task_demo",
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      io: {
        fileExists: vi.fn(async () => true),
      },
      runWhitelistedScript,
      emitEvent,
    });

    expect(text).toContain("runtime recovery requested");
    expect(runWhitelistedScript).toHaveBeenCalledWith({
      repoRoot: "/repo",
      scriptName: "runtime_resume_replan",
      args: ["tasks/task_demo"],
    });
    expect(emitEvent).toHaveBeenCalledWith(
      "orchestrate.task.runtime_recovery_requested",
      expect.objectContaining({ task_id: "task_demo" }),
    );
  });

  it("returns usage on missing task id", async () => {
    const text = await handleResumeSubcommand({
      payload: " ",
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      io: {
        fileExists: vi.fn(async () => false),
      },
      runWhitelistedScript: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
      emitEvent: vi.fn(async () => {}),
    });

    expect(text).toBe("usage: /orchestrate resume <task_id>");
  });
});
