import { buildSessionFileStem } from "../orchestrate-session.js";
import {
  handleBeforeAgentStartHook,
  resetDecodeContractCacheForTest,
} from "../orchestrate-session-agent-hook.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

function extractMetaBlock(context: string): Record<string, unknown> {
  const start = context.indexOf("BEGIN_ORCHESTRATE_AGENT_META");
  const end = context.indexOf("END_ORCHESTRATE_AGENT_META");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("missing agent meta block");
  }
  const json = context
    .slice(start + "BEGIN_ORCHESTRATE_AGENT_META".length, end)
    .trim();
  return JSON.parse(json) as Record<string, unknown>;
}

describe("orchestrate session agent hook", () => {
  beforeEach(() => {
    resetDecodeContractCacheForTest();
  });

  it("updates active drafting session from latest user message", async () => {
    let writtenTaskGoal = "";
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_demo",
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
        budget: { max_token_cost: 50000, max_execution_time_seconds: 3600 },
        constraints: [],
        deliverables: [],
        notes: [],
        open_questions: [],
      },
      history: [],
    };

    const result = await handleBeforeAgentStartHook({
      event: {
        messages: [
          { role: "system", content: "ignore" },
          { role: "user", content: "Build a websocket calculator" },
        ],
      },
      ctx: { sessionKey: "sess_demo" },
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      entryAgentDecodeContractPath: "/repo/templates/coordination/orchestrator/entry_agent_decode_contract.md",
      readOrchestrateSession: vi.fn(async () => session),
      writeOrchestrateSession: vi.fn(async (next) => {
        writtenTaskGoal = next.draft.task_goal;
      }),
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
        readText: vi.fn(async () => ""),
        writeJsonAtomic: vi.fn(async () => {}),
      },
      runWhitelistedScript: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
      getConsistencySnapshot: vi.fn(() => ({
        runtimeConsistency: "ok" as const,
        runtimeSignature: "sig",
        runtimeExpectedSignature: "sig",
      })),
      emitEvent: vi.fn(async () => {}),
    });

    expect(writtenTaskGoal).toContain("Build a websocket calculator");
    expect(result?.prependContext).toContain("BEGIN_ORCHESTRATE_AGENT_META");
    expect(result?.prependContext).not.toContain("BEGIN_ORCHESTRATE_AGENT_DECODE_CONTRACT");
    const meta = extractMetaBlock(result?.prependContext ?? "");
    expect(meta).toMatchObject({
      schema_version: "orchestrate-agent-meta-v1",
      session: {
        conversation_status: "ACTIVE_DRAFTING",
      },
      draft: {
        task_goal: "Build a websocket calculator",
      },
      runtime_guard: {
        runtime_consistency: "ok",
        should_block_side_effects: false,
      },
      action: {
        route: "intake_new_task",
        clarification_required: false,
      },
    });
  });

  it("ignores closed or missing sessions", async () => {
    await expect(
      handleBeforeAgentStartHook({
        event: { messages: [] },
        ctx: { sessionKey: "sess_demo" },
        repoRoot: "/repo",
        taskFoldersRoot: "/repo/tasks",
        entryAgentDecodeContractPath: "/repo/templates/coordination/orchestrator/entry_agent_decode_contract.md",
        readOrchestrateSession: vi.fn(async () => null),
        writeOrchestrateSession: vi.fn(async () => {}),
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
          readText: vi.fn(async () => ""),
          writeJsonAtomic: vi.fn(async () => {}),
        },
        runWhitelistedScript: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
        getConsistencySnapshot: vi.fn(() => ({
          runtimeConsistency: "ok" as const,
          runtimeSignature: "sig",
          runtimeExpectedSignature: "sig",
        })),
        emitEvent: vi.fn(async () => {}),
      }),
    ).resolves.toBeUndefined();
  });

  it("injects running replan state as explicit agent meta", async () => {
    const sessionStem = buildSessionFileStem("sess_run");
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_run",
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
        risk_level: "HIGH" as const,
        budget: { max_token_cost: 1200, max_execution_time_seconds: 90 },
        constraints: ["keep tests"],
        deliverables: ["RUNBOOK.md"],
        notes: ["paused"],
        open_questions: [],
      },
      history: [],
      last_run: {
        task_id: "task_demo",
        started_at: "2026-03-02T00:05:00.000Z",
        summary_id: "sum_demo",
      },
    };

    const result = await handleBeforeAgentStartHook({
      event: {
        messages: [{ role: "assistant", content: "ignore" }],
      },
      ctx: { sessionKey: "sess_run" },
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      entryAgentDecodeContractPath: "/repo/templates/coordination/orchestrator/entry_agent_decode_contract.md",
      readOrchestrateSession: vi.fn(async () => session),
      writeOrchestrateSession: vi.fn(async () => {}),
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
            "/repo/templates/coordination/orchestrator/entry_agent_decode_contract.md",
            `/repo/amendments/${sessionStem}.json`,
            "/repo/tasks/task_demo/meta.json",
          ].includes(target),
        ),
        readJsonOrDefault: vi.fn(async (target, fallback) => {
          if (target === `/repo/amendments/${sessionStem}.json`) {
            return {
              schema_version: "receptionist-amendment-queue-v1",
              session_key: "sess_run",
              task_id: "task_demo",
              status: "open",
              window_started_at: "2026-03-02T00:06:00.000Z",
              updated_at: "2026-03-02T00:06:00.000Z",
              items: [
                {
                  id: "amd_001",
                  created_at: "2026-03-02T00:06:00.000Z",
                  scope: "goal",
                  patch: { op: "set", value: "pause" },
                  source: "user_message",
                },
              ],
            } as typeof fallback;
          }
          if (target === "/repo/tasks/task_demo/meta.json") {
            return {
              planner_replan: {
                status: "applied",
                impact: "hard",
                worker_policy: "pause_and_require_replan",
                scope_summary: ["goal"],
              },
              runtime_replan: {
                consume_status: "paused",
              },
            } as typeof fallback;
          }
          return fallback;
        }),
        readText: vi.fn(async (target) => {
          if (target === "/repo/templates/coordination/orchestrator/entry_agent_decode_contract.md") {
            return "# Entry Agent Decode Contract\n\nUse meta.";
          }
          return "";
        }),
        writeJsonAtomic: vi.fn(async () => {}),
      },
      runWhitelistedScript: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
      getConsistencySnapshot: vi.fn(() => ({
        runtimeConsistency: "ok" as const,
        runtimeSignature: "sig",
        runtimeExpectedSignature: "sig",
      })),
      emitEvent: vi.fn(async () => {}),
    });

    expect(result?.prependContext).toContain("BEGIN_ORCHESTRATE_AGENT_DECODE_CONTRACT");
    expect(result?.prependContext).toContain("# Entry Agent Decode Contract");
    const meta = extractMetaBlock(result?.prependContext ?? "");
    expect(meta).toMatchObject({
      run: {
        task_id: "task_demo",
      },
      amendment: {
        queue_status: "open",
        item_count: 1,
        watermark: {
          head_version: 0,
          applying_version: 0,
          consumed_version: 0,
          last_release_reason: null,
        },
      },
      replan: {
        status: "applied",
        impact: "hard",
        worker_policy: "pause_and_require_replan",
        execution_status: "paused",
        scope_summary: ["goal"],
      },
      runtime_guard: {
        runtime_consistency: "ok",
        should_block_side_effects: true,
      },
      recommended_triggers: {
        status: true,
        resume_task_id: "task_demo",
      },
      action: {
        route: "amend_existing_task",
        target_task_id: "task_demo",
      },
    });
  });

  it("releases v2 effective patch on flush and forwards expected applying version", async () => {
    const sessionStem = buildSessionFileStem("sess_run_apply");
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_run_apply",
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
        risk_level: "HIGH" as const,
        budget: { max_token_cost: 1200, max_execution_time_seconds: 90 },
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
    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const result = await handleBeforeAgentStartHook({
      event: {
        messages: [{ role: "user", content: "update goal: ship dashboard v2" }],
      },
      ctx: { sessionKey: "sess_run_apply" },
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      entryAgentDecodeContractPath: "/repo/templates/coordination/orchestrator/entry_agent_decode_contract.md",
      readOrchestrateSession: vi.fn(async () => session),
      writeOrchestrateSession: vi.fn(async () => {}),
      statePaths: {
        pathState: "/repo/path_state.json",
        orchestrateSessionsDir: "/repo/sessions",
        orchestrateRequestsDir: "/repo/requests",
        orchestrateAmendmentsDir: "/repo/amendments",
        orchestrateAmendmentBatchesDir: "/repo/batches",
      },
      io: {
        fileExists: vi.fn(async (target) => target === `/repo/amendments/${sessionStem}.json`),
        readJsonOrDefault: vi.fn(async (target, fallback) => {
          if (target === `/repo/amendments/${sessionStem}.json`) {
            return {
              schema_version: "receptionist-amendment-queue-v1",
              session_key: "sess_run_apply",
              task_id: "task_demo",
              status: "open",
              window_started_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
              items: [
                {
                  id: "amd_old",
                  created_at: "2026-01-01T00:00:00.000Z",
                  scope: "notes",
                  patch: { op: "append", value: "legacy note" },
                  source: "user_message",
                },
              ],
            } as typeof fallback;
          }
          return fallback;
        }),
        readText: vi.fn(async () => ""),
        writeJsonAtomic: vi.fn(async () => {}),
      },
      runWhitelistedScript,
      getConsistencySnapshot: vi.fn(() => ({
        runtimeConsistency: "ok" as const,
        runtimeSignature: "sig",
        runtimeExpectedSignature: "sig",
      })),
      emitEvent: vi.fn(async () => {}),
    });

    expect(runWhitelistedScript).toHaveBeenCalledTimes(1);
    const firstCall = (runWhitelistedScript.mock.calls as unknown as Array<[Record<string, unknown>]>)[0];
    const scriptCall = firstCall?.[0];
    if (!scriptCall) {
      throw new Error("missing runWhitelistedScript call payload");
    }
    const scriptName = scriptCall["scriptName"];
    const scriptArgs = scriptCall["args"] as string[];
    expect(scriptName).toBe("planner_apply_amendment_batch");
    expect(scriptArgs).toContain("--effective-patch");
    expect(scriptArgs).toContain("--expected-applying-version");
    const expectedVersionIndex = scriptArgs.indexOf("--expected-applying-version");
    expect(expectedVersionIndex).toBeGreaterThan(-1);
    expect(scriptArgs[expectedVersionIndex + 1] ?? "").toMatch(/^[0-9]+$/u);

    const meta = extractMetaBlock(result?.prependContext ?? "");
    expect(meta).toMatchObject({
      amendment: {
        watermark: {
          head_version: expect.any(Number),
          applying_version: expect.any(Number),
          consumed_version: expect.any(Number),
        },
      },
    });
  });

  it("routes ambiguous running input into clarify_target without writing amendment queue", async () => {
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_run_clarify",
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
        amendment_queue_open: false,
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

    const writeJsonAtomic = vi.fn(async () => {});
    const result = await handleBeforeAgentStartHook({
      event: {
        messages: [{ role: "user", content: "this should go to task_other please" }],
      },
      ctx: { sessionKey: "sess_run_clarify" },
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      entryAgentDecodeContractPath: "/repo/templates/coordination/orchestrator/entry_agent_decode_contract.md",
      readOrchestrateSession: vi.fn(async () => session),
      writeOrchestrateSession: vi.fn(async () => {}),
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
        readText: vi.fn(async () => ""),
        writeJsonAtomic,
      },
      runWhitelistedScript: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
      getConsistencySnapshot: vi.fn(() => ({
        runtimeConsistency: "ok" as const,
        runtimeSignature: "sig",
        runtimeExpectedSignature: "sig",
      })),
      emitEvent: vi.fn(async () => {}),
    });

    const meta = extractMetaBlock(result?.prependContext ?? "");
    expect(meta).toMatchObject({
      action: {
        route: "clarify_target",
        clarification_required: true,
      },
      recommended_triggers: {
        clarify: true,
      },
    });
    expect(writeJsonAtomic).not.toHaveBeenCalled();
  });

  it("switches running session to ACTIVE_DRAFTING after new-task clarification answer", async () => {
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_run_new",
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
        pending_questions: ["Are you updating current task task_demo or starting a new task? Reply with: current task / new task."],
        amendment_queue_open: true,
        action_route: "clarify_target" as const,
        action_target_task_id: "task_demo",
        clarification_required: true,
        last_action_at: "2026-03-02T00:00:00.000Z",
      },
      draft: {
        goal_raw: "Ship dashboard",
        task_goal: "Ship dashboard",
        project_id: "prj_demo",
        workspace_root: "apps/demo",
        risk_level: "MEDIUM" as const,
        budget: { max_token_cost: 1200, max_execution_time_seconds: 90 },
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

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const result = await handleBeforeAgentStartHook({
      event: {
        messages: [{ role: "user", content: "另开一个新任务" }],
      },
      ctx: { sessionKey: "sess_run_new" },
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      entryAgentDecodeContractPath: "/repo/templates/coordination/orchestrator/entry_agent_decode_contract.md",
      readOrchestrateSession: vi.fn(async () => session),
      writeOrchestrateSession: vi.fn(async () => {}),
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
        readText: vi.fn(async () => ""),
        writeJsonAtomic: vi.fn(async () => {}),
      },
      runWhitelistedScript,
      getConsistencySnapshot: vi.fn(() => ({
        runtimeConsistency: "ok" as const,
        runtimeSignature: "sig",
        runtimeExpectedSignature: "sig",
      })),
      emitEvent: vi.fn(async () => {}),
    });

    const meta = extractMetaBlock(result?.prependContext ?? "");
    expect(meta).toMatchObject({
      session: {
        conversation_status: "ACTIVE_DRAFTING",
      },
      action: {
        route: "intake_new_task",
        target_task_id: null,
        clarification_required: false,
      },
    });
    expect(runWhitelistedScript).not.toHaveBeenCalled();
  });

  it("emits one decode-contract issue when file is missing and caches read attempts", async () => {
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_demo",
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
        goal_raw: "Build calculator",
        task_goal: "Build calculator",
        project_id: "prj_demo",
        workspace_root: "apps/demo",
        risk_level: "MEDIUM" as const,
        budget: { max_token_cost: 50000, max_execution_time_seconds: 3600 },
        constraints: [],
        deliverables: [],
        notes: [],
        open_questions: [],
      },
      history: [],
    };
    const emitEvent = vi.fn(async () => {});
    const fileExists = vi.fn(async (target: string) => {
      return target === "/repo/templates/coordination/orchestrator/entry_agent_decode_contract.md"
        ? false
        : false;
    });
    const readText = vi.fn(async () => "");

    await handleBeforeAgentStartHook({
      event: {
        messages: [{ role: "assistant", content: "ignore" }],
      },
      ctx: { sessionKey: "sess_demo" },
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      entryAgentDecodeContractPath: "/repo/templates/coordination/orchestrator/entry_agent_decode_contract.md",
      readOrchestrateSession: vi.fn(async () => session),
      writeOrchestrateSession: vi.fn(async () => {}),
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
        readText,
        writeJsonAtomic: vi.fn(async () => {}),
      },
      runWhitelistedScript: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
      getConsistencySnapshot: vi.fn(() => ({
        runtimeConsistency: "ok" as const,
        runtimeSignature: "sig",
        runtimeExpectedSignature: "sig",
      })),
      emitEvent,
    });

    await handleBeforeAgentStartHook({
      event: {
        messages: [{ role: "assistant", content: "ignore" }],
      },
      ctx: { sessionKey: "sess_demo" },
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      entryAgentDecodeContractPath: "/repo/templates/coordination/orchestrator/entry_agent_decode_contract.md",
      readOrchestrateSession: vi.fn(async () => session),
      writeOrchestrateSession: vi.fn(async () => {}),
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
        readText,
        writeJsonAtomic: vi.fn(async () => {}),
      },
      runWhitelistedScript: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
      getConsistencySnapshot: vi.fn(() => ({
        runtimeConsistency: "ok" as const,
        runtimeSignature: "sig",
        runtimeExpectedSignature: "sig",
      })),
      emitEvent,
    });

    expect(fileExists).toHaveBeenCalledTimes(1);
    expect(readText).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith(
      "orchestrate.entry_agent.decode_contract_issue",
      expect.objectContaining({
        issue: "missing",
      }),
    );
  });
});
