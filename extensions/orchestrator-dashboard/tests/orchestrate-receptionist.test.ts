import { describe, expect, it } from "vitest";
import {
  appendAmendmentEntriesToLogV2,
  appendAmendmentItems,
  buildInitialPlannerAmendmentWatermarkV2,
  applyReceptionistIntakeMessage,
  buildPlannerAmendmentBatch,
  compilePlannerEffectivePatchV2,
  markPlannerAmendmentApplyingV2,
  markPlannerAmendmentConsumedV2,
  shouldReleasePlannerEffectivePatch,
} from "../orchestrate-receptionist.js";
import { buildEmptyOrchestrateSession } from "../orchestrate-session.js";

describe("orchestrate receptionist", () => {
  it("keeps intake rule-based and records pending questions", () => {
    const base = buildEmptyOrchestrateSession({
      sessionKey: "sess_demo",
      channel: "cli",
      senderId: "tester",
    });

    const next = applyReceptionistIntakeMessage(base, "Build websocket calculator", {
      now: "2026-03-02T00:00:00.000Z",
    });

    expect(next.draft.task_goal).toContain("Build websocket calculator");
    expect(next.receptionist.pending_questions).toContain("Which project_id should this run attach to?");
    expect(next.receptionist.pending_questions).toContain("Which workspace_root should the planner use?");
  });

  it("batches running amendments into planner-facing structured changes", () => {
    const session = buildEmptyOrchestrateSession({
      sessionKey: "sess_demo",
      channel: "cli",
      senderId: "tester",
    });
    session.status = "RUNNING";
    session.last_run = {
      task_id: "task_demo",
      started_at: "2026-03-02T00:00:00.000Z",
      summary_id: "sum_demo",
    };

    const first = appendAmendmentItems({
      session,
      existingQueue: null,
      message: "workspace-root: apps/new-demo",
      now: "2026-03-02T00:00:00.000Z",
    });
    const second = appendAmendmentItems({
      session: first.session,
      existingQueue: first.queue,
      message: "workspace-root: apps/final-demo",
      now: "2026-03-02T00:00:05.000Z",
    });

    if (!second.queue) {
      throw new Error("expected amendment queue");
    }
    const batch = buildPlannerAmendmentBatch(second.queue, {
      now: "2026-03-02T00:00:30.000Z",
    });

    expect(batch.merged_changes.workspace_patch).toEqual({
      op: "set",
      value: "workspace-root: apps/final-demo",
    });
    expect(second.session.receptionist.amendment_queue_open).toBe(true);
  });

  it("compiles v2 effective patch and tracks watermark release lifecycle", () => {
    const now = "2026-03-02T00:00:00.000Z";
    const appends = [
      { id: "amd_001", created_at: now, scope: "goal", patch: { op: "set", value: "goal: one" }, source: "user_message" },
      {
        id: "amd_002",
        created_at: "2026-03-02T00:00:05.000Z",
        scope: "goal",
        patch: { op: "set", value: "goal: two" },
        source: "user_message",
      },
      {
        id: "amd_003",
        created_at: "2026-03-02T00:00:06.000Z",
        scope: "constraints",
        patch: { op: "append", value: "must keep tests" },
        source: "user_message",
      },
      {
        id: "amd_004",
        created_at: "2026-03-02T00:00:07.000Z",
        scope: "budget",
        patch: { op: "set", value: "budget: 1200,90" },
        source: "user_message",
      },
    ] as const;
    const logResult = appendAmendmentEntriesToLogV2({
      log: null,
      sessionKey: "sess_demo",
      taskId: "task_demo",
      items: [...appends],
      now: "2026-03-02T00:00:08.000Z",
    });
    const compiled = compilePlannerEffectivePatchV2({
      log: logResult.log,
      fromVersion: 1,
      toVersion: 4,
      now: "2026-03-02T00:00:10.000Z",
    });
    expect(compiled.effective_patch.task_goal_patch?.value).toBe("goal: two");
    expect(compiled.effective_patch.constraints_patch).toEqual([{ op: "append", value: "must keep tests" }]);
    expect(compiled.effective_patch.budget_patch?.value).toBe("budget: 1200,90");
    expect(compiled.conflicts.some((item) => item.field === "task_goal")).toBe(true);

    const initialWatermark = buildInitialPlannerAmendmentWatermarkV2({
      sessionKey: "sess_demo",
      taskId: "task_demo",
      now: "2026-03-02T00:00:10.000Z",
    });
    const release = shouldReleasePlannerEffectivePatch({
      log: logResult.log,
      watermark: initialWatermark,
      now: "2026-03-02T00:00:12.000Z",
      maxBatchCount: 2,
      maxWaitMs: 60_000,
    });
    expect(release).toMatchObject({
      should_release: true,
      reason: "batch_count",
    });
    const applying = markPlannerAmendmentApplyingV2({
      watermark: initialWatermark,
      sessionKey: "sess_demo",
      taskId: "task_demo",
      headVersion: logResult.log.head_version,
      reason: "batch_count",
      now: "2026-03-02T00:00:12.000Z",
    });
    expect(applying.applying_version).toBe(4);
    const consumed = markPlannerAmendmentConsumedV2({
      watermark: applying,
      now: "2026-03-02T00:00:13.000Z",
    });
    expect(consumed.consumed_version).toBe(4);
    expect(consumed.applying_version).toBe(4);
  });

  it("keeps v1 batch merge and v2 effective patch behavior consistent", () => {
    const session = buildEmptyOrchestrateSession({
      sessionKey: "sess_consistency",
      channel: "cli",
      senderId: "tester",
    });
    session.status = "RUNNING";
    session.last_run = {
      task_id: "task_consistency",
      started_at: "2026-03-02T00:00:00.000Z",
      summary_id: "sum_consistency",
    };

    const messages = [
      "goal: ship dashboard v1",
      "goal: ship dashboard v2",
      "constraint: keep tests",
      "deliverable: RUNBOOK.md",
      "workspace-root: apps/demo-final",
      "budget: 2400,180",
      "note: prioritize auditability",
    ];
    let queueResult = appendAmendmentItems({
      session,
      existingQueue: null,
      message: messages[0],
      now: "2026-03-02T00:00:00.000Z",
    });
    for (let index = 1; index < messages.length; index += 1) {
      queueResult = appendAmendmentItems({
        session: queueResult.session,
        existingQueue: queueResult.queue,
        message: messages[index] ?? "",
        now: `2026-03-02T00:00:0${String(index)}.000Z`,
      });
    }
    if (!queueResult.queue) {
      throw new Error("expected amendment queue for consistency test");
    }

    const v1Batch = buildPlannerAmendmentBatch(queueResult.queue, {
      now: "2026-03-02T00:00:10.000Z",
    });
    const log = appendAmendmentEntriesToLogV2({
      log: null,
      sessionKey: "sess_consistency",
      taskId: "task_consistency",
      items: queueResult.queue.items,
      now: "2026-03-02T00:00:10.000Z",
    }).log;
    const v2Patch = compilePlannerEffectivePatchV2({
      log,
      fromVersion: 1,
      toVersion: log.head_version,
      now: "2026-03-02T00:00:10.000Z",
    });

    expect(v2Patch.effective_patch.task_goal_patch).toEqual(v1Batch.merged_changes.task_goal_patch);
    expect(v2Patch.effective_patch.constraints_patch).toEqual(v1Batch.merged_changes.constraints_patch);
    expect(v2Patch.effective_patch.deliverables_patch).toEqual(v1Batch.merged_changes.deliverables_patch);
    expect(v2Patch.effective_patch.notes_patch).toEqual(v1Batch.merged_changes.notes_patch);
    expect(v2Patch.effective_patch.workspace_patch).toEqual(v1Batch.merged_changes.workspace_patch);
    expect(v2Patch.effective_patch.budget_patch).toEqual(v1Batch.merged_changes.budget_patch);
  });
});
