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

    expect(text).toContain("hard replan resume triggered");
    expect(runWhitelistedScript).toHaveBeenCalledWith({
      repoRoot: "/repo",
      scriptName: "planner_resume_hard_replan",
      args: ["tasks/task_demo"],
    });
    expect(emitEvent).toHaveBeenCalledWith(
      "orchestrate.task.replan_resumed",
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
