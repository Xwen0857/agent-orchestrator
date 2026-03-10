import {
  buildEntryActionGuidance,
  extractIntentSignals,
  resolveEntryAction,
} from "../orchestrate-entry-action-contract.js";
import { buildEmptyOrchestrateSession } from "../orchestrate-session.js";
import { describe, expect, it } from "vitest";

describe("orchestrate-entry-action-contract", () => {
  it("routes running amendment-like input to existing task", () => {
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
    const signals = extractIntentSignals("请修改预算 budget: 1200,90", session);
    const resolution = resolveEntryAction(signals, session);

    expect(resolution).toMatchObject({
      route: "amend_existing_task",
      target_task_id: "task_demo",
      clarification_required: false,
    });
  });

  it("routes conflicting explicit task id to clarify_target", () => {
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
    const signals = extractIntentSignals("update task_id=task_other", session);
    const resolution = resolveEntryAction(signals, session);

    expect(resolution.route).toBe("clarify_target");
    expect(resolution.clarification_required).toBe(true);
    expect(resolution.guidance_reason).toBe("explicit_task_id_conflict");
  });

  it("builds missing configuration guidance for intake", () => {
    const session = buildEmptyOrchestrateSession({
      sessionKey: "sess_draft",
      channel: "cli",
      senderId: "tester",
    });
    const signals = extractIntentSignals("new task for release checklist", session);
    const resolution = resolveEntryAction(signals, session);
    const guidance = buildEntryActionGuidance(resolution, session);

    expect(resolution.route).toBe("intake_new_task");
    expect(guidance.next_step).toBe("collect_intake");
    expect(guidance.missing_configuration).toEqual([
      "task_goal",
      "project_id",
      "workspace_root",
    ]);
  });

  it("keeps clarify_target until explicit clarification answer is given", () => {
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

    const unresolved = resolveEntryAction(
      extractIntentSignals("update budget to 1000", session),
      session,
    );
    expect(unresolved.route).toBe("clarify_target");
    expect(unresolved.clarification_required).toBe(true);

    const resolved = resolveEntryAction(extractIntentSignals("继续当前任务吧", session), session);
    expect(resolved.route).toBe("amend_existing_task");
    expect(resolved.clarification_required).toBe(false);
  });

  it("keeps clarify_target when clarification answer is conflicting", () => {
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

    const conflict = resolveEntryAction(
      extractIntentSignals("continue current but start a new task", session),
      session,
    );
    expect(conflict.route).toBe("clarify_target");
    expect(conflict.clarification_required).toBe(true);
  });
});
