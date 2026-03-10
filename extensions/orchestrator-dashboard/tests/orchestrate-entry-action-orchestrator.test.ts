import { orchestrateEntryActionStep } from "../orchestrate-entry-action-orchestrator.js";
import { buildEmptyOrchestrateSession } from "../orchestrate-session.js";
import { describe, expect, it } from "vitest";

describe("orchestrate-entry-action-orchestrator", () => {
  it("routes running amendment input into queue write", () => {
    const session = buildEmptyOrchestrateSession({
      sessionKey: "sess_run",
      channel: "cli",
      senderId: "tester",
    });
    session.status = "RUNNING";
    session.last_run = {
      task_id: "task_demo",
      started_at: "2026-03-02T00:00:00.000Z",
      summary_id: "sum_demo",
    };

    const step = orchestrateEntryActionStep({
      session,
      latestUserMessage: "请更新预算 budget: 1000,120",
      existingQueue: null,
      now: "2026-03-02T00:01:00.000Z",
    });

    expect(step.actionResolution?.route).toBe("amend_existing_task");
    expect(step.queueMutation).toBe("write_queue");
    expect(step.nextQueue?.items.length).toBe(1);
    expect(step.nextSession.receptionist.action_route).toBe("amend_existing_task");
  });

  it("keeps ambiguous running input in clarify_target without queue side effects", () => {
    const session = buildEmptyOrchestrateSession({
      sessionKey: "sess_run",
      channel: "cli",
      senderId: "tester",
    });
    session.status = "RUNNING";
    session.last_run = {
      task_id: "task_demo",
      started_at: "2026-03-02T00:00:00.000Z",
      summary_id: "sum_demo",
    };

    const step = orchestrateEntryActionStep({
      session,
      latestUserMessage: "task_id=task_other",
      existingQueue: null,
      now: "2026-03-02T00:01:00.000Z",
    });

    expect(step.actionResolution?.route).toBe("clarify_target");
    expect(step.queueMutation).toBe("none");
    expect(step.shouldFlush).toBe(false);
    expect(step.nextSession.receptionist.clarification_required).toBe(true);
  });

  it("switches running session to ACTIVE_DRAFTING after explicit new-task clarification", () => {
    const session = buildEmptyOrchestrateSession({
      sessionKey: "sess_run",
      channel: "cli",
      senderId: "tester",
    });
    session.status = "RUNNING";
    session.last_run = {
      task_id: "task_demo",
      started_at: "2026-03-02T00:00:00.000Z",
      summary_id: "sum_demo",
    };
    session.receptionist.clarification_required = true;
    session.receptionist.action_route = "clarify_target";
    session.receptionist.action_target_task_id = "task_demo";

    const step = orchestrateEntryActionStep({
      session,
      latestUserMessage: "另开一个新任务",
      existingQueue: {
        schema_version: "receptionist-amendment-queue-v1",
        session_key: "sess_run",
        task_id: "task_demo",
        status: "open",
        window_started_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:00.000Z",
        items: [],
      },
      now: "2026-03-02T00:01:00.000Z",
    });

    expect(step.actionResolution?.route).toBe("intake_new_task");
    expect(step.nextSession.status).toBe("ACTIVE_DRAFTING");
    expect(step.nextSession.last_run?.task_id).toBe("task_demo");
    expect(step.nextSession.receptionist.amendment_queue_open).toBe(false);
    expect(step.nextSession.receptionist.action_route).toBe("intake_new_task");
    expect(step.nextQueue).toBeNull();
  });
});
