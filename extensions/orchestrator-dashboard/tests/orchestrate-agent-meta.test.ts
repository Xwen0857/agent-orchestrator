import {
  buildOrchestrateAgentMeta,
  extractOrchestrateAgentReplan,
  renderOrchestrateAgentMetaBlock,
} from "../orchestrate-agent-meta.js";
import { buildEmptyOrchestrateSession } from "../orchestrate-session.js";
import { describe, expect, it } from "vitest";

describe("orchestrate-agent-meta", () => {
  it("builds stable defaults for drafting sessions without a run", () => {
    const session = buildEmptyOrchestrateSession({
      sessionKey: "sess_demo",
      channel: "cli",
      senderId: "tester",
    });
    session.draft.task_goal = "Ship dashboard";

    const meta = buildOrchestrateAgentMeta({ session });

    expect(meta).toMatchObject({
      schema_version: "orchestrate-agent-meta-v1",
      run: {
        task_id: null,
        summary_id: null,
        started_at: null,
      },
      amendment: {
        queue_status: "none",
        item_count: 0,
        watermark: {
          head_version: 0,
          applying_version: 0,
          consumed_version: 0,
          last_release_reason: null,
        },
      },
      action: {
        route: "intake_new_task",
        target_task_id: null,
        clarification_required: false,
      },
      replan: {
        status: null,
        impact: null,
        worker_policy: null,
        execution_status: null,
        consumed_at: null,
        blocked_reason: null,
      },
      runtime_guard: {
        runtime_consistency: "unknown",
        should_block_side_effects: false,
      },
      recommended_triggers: {
        summary: true,
        status: false,
        resume_task_id: null,
        clarify: false,
      },
    });
  });

  it("detects hard paused replan and recommends resume", () => {
    const session = buildEmptyOrchestrateSession({
      sessionKey: "sess_run",
      channel: "cli",
      senderId: "tester",
    });
    session.status = "RUNNING";
    session.last_run = {
      task_id: "task_demo",
      started_at: "2026-03-02T00:05:00.000Z",
      summary_id: "sum_demo",
    };

    const meta = buildOrchestrateAgentMeta({
      session,
      taskMeta: {
        planner_replan: {
          status: "applied",
          impact: "hard",
          worker_policy: "pause_and_require_replan",
          scope_summary: ["goal"],
        },
        runtime_replan: {
          consume_status: "paused",
        },
      },
      runtimeConsistency: {
        runtimeConsistency: "ok",
      },
    });

    expect(meta.replan).toMatchObject({
      status: "applied",
      impact: "hard",
      worker_policy: "pause_and_require_replan",
      execution_status: "paused",
      scope_summary: ["goal"],
      consumed_at: null,
      blocked_reason: null,
    });
    expect(meta.runtime_guard).toEqual({
      runtime_consistency: "ok",
      should_block_side_effects: true,
    });
    expect(meta.recommended_triggers).toEqual({
      summary: false,
      status: true,
      resume_task_id: "task_demo",
      clarify: false,
    });
  });

  it("renders the explicit meta block markers", () => {
    const session = buildEmptyOrchestrateSession({
      sessionKey: "sess_block",
      channel: "cli",
      senderId: "tester",
    });
    const block = renderOrchestrateAgentMetaBlock(buildOrchestrateAgentMeta({ session }));

    expect(block).toContain("BEGIN_ORCHESTRATE_AGENT_META");
    expect(block).toContain('"schema_version": "orchestrate-agent-meta-v1"');
    expect(block).toContain("END_ORCHESTRATE_AGENT_META");
  });

  it("normalizes replan fields from task meta", () => {
    expect(
      extractOrchestrateAgentReplan({
        planner_replan: {
          status: " applied ",
          impact: " refresh_required ",
          worker_policy: " revalidate_then_resume ",
          scope_summary: [" workspace ", "", "budget"],
        },
        runtime_replan: {
          consume_status: " awaiting_revalidation ",
        },
      }),
    ).toEqual({
      status: "applied",
      impact: "refresh_required",
      worker_policy: "revalidate_then_resume",
      execution_status: "awaiting_revalidation",
      scope_summary: ["workspace", "budget"],
      requested_at: null,
      applied_at: null,
      consumed_at: null,
      resumed_at: null,
      blocked_reason: null,
    });
  });
});
