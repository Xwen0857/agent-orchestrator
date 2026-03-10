import { buildSessionFileStem } from "../orchestrate-session.js";
import { renderIngressDebugProjection } from "../orchestrate-ingress-debug.js";
import { createIngressRepository, hydrateIngressState } from "../orchestrate-ingress-repository.js";
import {
  buildHydratedIngressDebugProjection,
  processRunningAmendmentMessage,
} from "../orchestrate-ingress-flow.js";
import type { IngressHydratedState, IngressRepository } from "../orchestrate-ingress-types.js";
import { describe, expect, it, vi } from "vitest";

describe("orchestrate ingress flow", () => {
  it("hydrates ingress state from queue/log/effective patch/watermark stores", async () => {
    const sessionStem = buildSessionFileStem("sess_debug");
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_debug",
      channel: "cli",
      sender_id: "tester",
      status: "RUNNING" as const,
      started_at: "2026-03-02T00:00:00.000Z",
      updated_at: "2026-03-02T00:00:00.000Z",
      entry_agent: { active: true, mode: "conversation_capture" as const },
      receptionist: {
        active: true,
        mode: "guided_intake" as const,
        last_briefing_at: "2026-03-02T00:00:00.000Z",
        pending_questions: [],
        amendment_queue_open: true,
        action_route: "amend_existing_task" as const,
        action_target_task_id: "task_demo",
        clarification_required: false,
        last_action_at: "2026-03-02T00:00:00.000Z",
      },
      draft: {
        goal_raw: "Ship dashboard",
        task_goal: "Ship dashboard",
        project_id: "prj_demo",
        workspace_root: "apps/demo",
        risk_level: "MEDIUM" as const,
        budget: { max_token_cost: 1200, max_execution_time_seconds: 90 },
        requested_mode: "auto" as const,
        constraints: [],
        deliverables: [],
        notes: [],
        open_questions: [],
      },
      history: [],
      last_run: {
        task_id: "task_demo",
        started_at: "2026-03-02T00:05:00.000Z",
        summary_id: "sum_demo",
      },
    };

    const repository = createIngressRepository({
      taskFoldersRoot: "/repo/tasks",
      statePaths: {
        pathState: "/repo/path_state.json",
        orchestrateSessionsDir: "/repo/sessions",
        orchestrateRequestsDir: "/repo/requests",
        orchestrateAmendmentsDir: "/repo/amendments",
        orchestrateAmendmentBatchesDir: "/repo/batches",
      },
      io: {
        fileExists: vi.fn(async (target) =>
          [
            `/repo/amendments/${sessionStem}.json`,
            `/repo/amendments/${sessionStem}.log.v2.json`,
            `/repo/batches/${sessionStem}.effective-patch.v2.json`,
            `/repo/batches/${sessionStem}.watermark.v2.json`,
            "/repo/tasks/task_demo/meta.json",
          ].includes(target),
        ),
        readJsonOrDefault: vi.fn(async (target, fallback) => {
          if (target === `/repo/amendments/${sessionStem}.json`) {
            return {
              schema_version: "receptionist-amendment-queue-v1",
              session_key: "sess_debug",
              task_id: "task_demo",
              status: "open",
              window_started_at: "2026-03-02T00:06:00.000Z",
              updated_at: "2026-03-02T00:06:00.000Z",
              items: [
                {
                  id: "amd_001",
                  created_at: "2026-03-02T00:06:00.000Z",
                  scope: "goal",
                  patch: { op: "set", value: "Ship dashboard v2" },
                  source: "user_message",
                },
              ],
            } as typeof fallback;
          }
          if (target === `/repo/amendments/${sessionStem}.log.v2.json`) {
            return {
              schema_version: "receptionist-amendment-log-v2",
              session_key: "sess_debug",
              task_id: "task_demo",
              head_version: 3,
              updated_at: "2026-03-02T00:06:30.000Z",
              entries: [
                {
                  entry_id: "log_001",
                  version: 1,
                  received_at: "2026-03-02T00:06:00.000Z",
                  scope: "goal",
                  patch: { op: "set", value: "Ship dashboard" },
                  source: "user_message",
                  dedupe_basis: "goal:set:ship dashboard",
                },
                {
                  entry_id: "log_002",
                  version: 2,
                  received_at: "2026-03-02T00:06:10.000Z",
                  scope: "constraints",
                  patch: { op: "append", value: "keep tests" },
                  source: "user_message",
                  dedupe_basis: "constraints:append:keep tests",
                },
                {
                  entry_id: "log_003",
                  version: 3,
                  received_at: "2026-03-02T00:06:20.000Z",
                  scope: "goal",
                  patch: { op: "set", value: "Ship dashboard v2" },
                  source: "user_message",
                  dedupe_basis: "goal:set:ship dashboard v2",
                },
              ],
            } as typeof fallback;
          }
          if (target === `/repo/batches/${sessionStem}.effective-patch.v2.json`) {
            return {
              schema_version: "planner-effective-patch-v2",
              session_key: "sess_debug",
              task_id: "task_demo",
              compiled_at: "2026-03-02T00:06:30.000Z",
              compiled_from_versions: {
                from_version: 2,
                to_version: 3,
              },
              effective_patch: {
                task_goal_patch: { op: "set", value: "Ship dashboard v2" },
                constraints_patch: [{ op: "append", value: "keep tests" }],
                deliverables_patch: [],
                notes_patch: [],
                workspace_patch: null,
                budget_patch: null,
              },
              source_versions: {
                goal: [3],
                constraints: [2],
                deliverables: [],
                notes: [],
                workspace: [],
                budget: [],
              },
              dedupe_basis: {
                goal: "goal:set:ship dashboard v2",
                constraints: "constraints:append:keep tests",
                deliverables: "",
                notes: "",
                workspace: "",
                budget: "",
              },
              conflicts: [],
            } as typeof fallback;
          }
          if (target === `/repo/batches/${sessionStem}.watermark.v2.json`) {
            return {
              schema_version: "planner-amendment-watermark-v2",
              session_key: "sess_debug",
              task_id: "task_demo",
              head_version: 3,
              applying_version: 0,
              consumed_version: 1,
              last_release_reason: "batch_count",
              updated_at: "2026-03-02T00:06:30.000Z",
            } as typeof fallback;
          }
          if (target === "/repo/tasks/task_demo/meta.json") {
            return {
              planner_replan: {
                status: "queued",
              },
              runtime_replan: {
                consume_status: "pending_consume",
              },
            } as typeof fallback;
          }
          return fallback;
        }),
        writeJsonAtomic: vi.fn(async () => {}),
      },
    });

    const state = await hydrateIngressState({
      repository,
      session,
      sessionKey: "sess_debug",
    });

    expect(state.queue?.items).toHaveLength(1);
    expect(state.amendmentLog?.head_version).toBe(3);
    expect(state.effectivePatch?.compiled_from_versions).toMatchObject({
      from_version: 2,
      to_version: 3,
    });
    expect(state.amendmentWatermark).toMatchObject({
      head_version: 3,
      consumed_version: 1,
      last_release_reason: "batch_count",
    });

    const projection = buildHydratedIngressDebugProjection(state);
    expect(projection).toMatchObject({
      session_status: "RUNNING",
      action_route: "amend_existing_task",
      action_target_task_id: "task_demo",
      queue: {
        status: "open",
        item_count: 1,
      },
      log: {
        head_version: 3,
        entry_count: 3,
      },
      effective_patch: {
        from_version: 2,
        to_version: 3,
        conflict_count: 0,
      },
      watermark: {
        head_version: 3,
        applying_version: 0,
        consumed_version: 1,
        last_release_reason: "batch_count",
      },
      replan: {
        status: "queued",
        execution_status: "pending_consume",
      },
    });
    expect(renderIngressDebugProjection(projection)).toContain("watermark_head_version: 3");
    expect(renderIngressDebugProjection(projection)).toContain("replan_status: queued");
  });

  it("hydrates empty ingress state when no running task exists", async () => {
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_empty",
      channel: "cli",
      sender_id: "tester",
      status: "ACTIVE_DRAFTING" as const,
      started_at: "2026-03-02T00:00:00.000Z",
      updated_at: "2026-03-02T00:00:00.000Z",
      entry_agent: { active: true, mode: "conversation_capture" as const },
      receptionist: {
        active: true,
        mode: "guided_intake" as const,
        last_briefing_at: "2026-03-02T00:00:00.000Z",
        pending_questions: [],
        amendment_queue_open: false,
        action_route: "intake_new_task" as const,
        action_target_task_id: null,
        clarification_required: false,
        last_action_at: "2026-03-02T00:00:00.000Z",
      },
      draft: {
        goal_raw: "",
        task_goal: "",
        project_id: "",
        workspace_root: "",
        risk_level: "MEDIUM" as const,
        budget: { max_token_cost: 1200, max_execution_time_seconds: 90 },
        requested_mode: "auto" as const,
        constraints: [],
        deliverables: [],
        notes: [],
        open_questions: [],
      },
      history: [],
    };
    const fileExists = vi.fn(async () => false);
    const repository = createIngressRepository({
      taskFoldersRoot: "/repo/tasks",
      statePaths: {
        pathState: "/repo/path_state.json",
        orchestrateSessionsDir: "/repo/sessions",
        orchestrateRequestsDir: "/repo/requests",
        orchestrateAmendmentsDir: "/repo/amendments",
        orchestrateAmendmentBatchesDir: "/repo/batches",
      },
      io: {
        fileExists,
        readJsonOrDefault: vi.fn(async (_target, fallback) => fallback),
        writeJsonAtomic: vi.fn(async () => {}),
      },
    });

    const state = await hydrateIngressState({
      repository,
      session,
      sessionKey: "sess_empty",
    });

    expect(state).toMatchObject({
      queue: null,
      amendmentLog: null,
      amendmentWatermark: null,
      effectivePatch: null,
      taskMeta: null,
    });
    expect(fileExists).not.toHaveBeenCalled();
  });

  it("returns null task meta when running task meta file is absent", async () => {
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_missing_meta",
      channel: "cli",
      sender_id: "tester",
      status: "RUNNING" as const,
      started_at: "2026-03-02T00:00:00.000Z",
      updated_at: "2026-03-02T00:00:00.000Z",
      entry_agent: { active: true, mode: "conversation_capture" as const },
      receptionist: {
        active: true,
        mode: "guided_intake" as const,
        last_briefing_at: "2026-03-02T00:00:00.000Z",
        pending_questions: [],
        amendment_queue_open: true,
        action_route: "amend_existing_task" as const,
        action_target_task_id: "task_demo",
        clarification_required: false,
        last_action_at: "2026-03-02T00:00:00.000Z",
      },
      draft: {
        goal_raw: "Ship dashboard",
        task_goal: "Ship dashboard",
        project_id: "prj_demo",
        workspace_root: "apps/demo",
        risk_level: "MEDIUM" as const,
        budget: { max_token_cost: 1200, max_execution_time_seconds: 90 },
        requested_mode: "auto" as const,
        constraints: [],
        deliverables: [],
        notes: [],
        open_questions: [],
      },
      history: [],
      last_run: {
        task_id: "task_demo",
        started_at: "2026-03-02T00:05:00.000Z",
        summary_id: "sum_demo",
      },
    };
    const repository = createIngressRepository({
      taskFoldersRoot: "/repo/tasks",
      statePaths: {
        pathState: "/repo/path_state.json",
        orchestrateSessionsDir: "/repo/sessions",
        orchestrateRequestsDir: "/repo/requests",
        orchestrateAmendmentsDir: "/repo/amendments",
        orchestrateAmendmentBatchesDir: "/repo/batches",
      },
      io: {
        fileExists: vi.fn(async () => false),
        readJsonOrDefault: vi.fn(async (_target, fallback) => fallback),
        writeJsonAtomic: vi.fn(async () => {}),
      },
    });

    const state = await hydrateIngressState({
      repository,
      session,
      sessionKey: "sess_missing_meta",
    });

    expect(state.taskMeta).toBeNull();
  });

  it("releases effective patch through flow helper and closes the queue window", async () => {
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_release",
      channel: "cli",
      sender_id: "tester",
      status: "RUNNING" as const,
      started_at: "2026-03-02T00:00:00.000Z",
      updated_at: "2026-03-02T00:00:00.000Z",
      entry_agent: { active: true, mode: "conversation_capture" as const },
      receptionist: {
        active: true,
        mode: "guided_intake" as const,
        last_briefing_at: "2026-03-02T00:00:00.000Z",
        pending_questions: [],
        amendment_queue_open: true,
        action_route: "amend_existing_task" as const,
        action_target_task_id: "task_demo",
        clarification_required: false,
        last_action_at: "2026-03-02T00:00:00.000Z",
      },
      draft: {
        goal_raw: "Ship dashboard",
        task_goal: "Ship dashboard",
        project_id: "prj_demo",
        workspace_root: "apps/demo",
        risk_level: "MEDIUM" as const,
        budget: { max_token_cost: 1200, max_execution_time_seconds: 90 },
        requested_mode: "auto" as const,
        constraints: [],
        deliverables: [],
        notes: [],
        open_questions: [],
      },
      history: [],
      last_run: {
        task_id: "task_demo",
        started_at: "2026-03-02T00:05:00.000Z",
        summary_id: "sum_demo",
      },
    };

    const state: IngressHydratedState = {
      session,
      queue: {
        schema_version: "receptionist-amendment-queue-v1" as const,
        session_key: "sess_release",
        task_id: "task_demo",
        status: "open" as const,
        window_started_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:00.000Z",
        items: [],
      },
      amendmentLog: null,
      amendmentWatermark: null,
      effectivePatch: null,
      effectivePatchPath: "",
      taskMeta: null,
    };

    const writeOrchestrateSession = vi.fn(async () => {});
    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});
    const repository: IngressRepository = {
      hydrateState: vi.fn(async () => state),
      refreshTaskMeta: vi.fn(async () => null),
      persistQueueCapture: vi.fn(async () => {}),
      persistAmendmentLedger: vi.fn(async () => {}),
      persistCompiledPatch: vi.fn(async (nextState) => {
        nextState.effectivePatchPath = "/repo/batches/sess_release.effective-patch.v2.json";
        return nextState.effectivePatchPath;
      }),
      beginPatchRelease: vi.fn(async () => {}),
      completePatchRelease: vi.fn(async (nextState, now) => {
        if (nextState.amendmentWatermark) {
          nextState.amendmentWatermark = {
            ...nextState.amendmentWatermark,
            updated_at: now,
          };
        }
        if (!nextState.queue) {
          return;
        }
        nextState.queue = {
          ...nextState.queue,
          status: "flushed",
          updated_at: now,
        };
      }),
    };

    await processRunningAmendmentMessage({
      state,
      repository,
      sessionKey: "sess_release",
      latestUserMessage: "please flush and update goal to ship dashboard v2",
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      writeOrchestrateSession,
      runWhitelistedScript,
      emitEvent,
      now: "2026-03-02T00:10:00.000Z",
    });

    expect(runWhitelistedScript).toHaveBeenCalledTimes(1);
    const scriptCall = (
      runWhitelistedScript.mock.calls as unknown as Array<[Record<string, unknown>]>
    )[0]?.[0];
    expect(scriptCall?.scriptName).toBe("planner_apply_amendment_batch");
    expect((scriptCall?.args as string[]) ?? []).toContain("--effective-patch");
    expect((scriptCall?.args as string[]) ?? []).toContain("--expected-applying-version");

    expect(state.queue?.status).toBe("flushed");
    expect(state.session.receptionist.amendment_queue_open).toBe(false);
    expect(state.amendmentWatermark?.consumed_version).toBeGreaterThan(0);
    expect(emitEvent).toHaveBeenCalledWith(
      "orchestrate.receptionist.release_triggered_v2",
      expect.objectContaining({
        session_key: "sess_release",
        task_id: "task_demo",
      }),
    );
    expect(repository.persistAmendmentLedger).toHaveBeenCalled();
    expect(repository.beginPatchRelease).toHaveBeenCalled();
    expect(repository.completePatchRelease).toHaveBeenCalled();
  });
});
