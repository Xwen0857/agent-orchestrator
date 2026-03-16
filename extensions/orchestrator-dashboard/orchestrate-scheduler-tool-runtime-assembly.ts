import fs from "node:fs/promises";
import path from "node:path";

import type { SchedulerExecutionMode } from "./orchestrate-scheduler-contract.js";
import {
  buildSchedulerKeeperAssemblyQuery,
  buildKeeperFeedbackFingerprint,
  buildWorkerFailurePatternSummary,
  buildWorkerRuntimeMetaSummary,
  buildWorkerRuntimeView,
  type WorkerRuntimeView,
} from "./orchestrate-worker-runtime-contract.js";
import {
  extractObject,
  readJson,
  updateTaskMeta,
  writeJsonAtomic,
} from "./orchestrate-scheduler-repository.js";
import { normalizeScheduler } from "./orchestrate-scheduler-task-model.js";
import type { SchedulerToolRuntime } from "./orchestrate-scheduler-tool-transition.js";

export async function prepareWorkerRuntimeArtifacts(input: {
  runtime: SchedulerToolRuntime;
  tasksRoot: string;
  taskId: string;
  action: "dispatch" | "retry";
  lane: "assigned_ready" | "retry" | "recovery";
  operationId: string;
  dispatchSeq: number;
  mode: SchedulerExecutionMode;
}): Promise<WorkerRuntimeView> {
  const taskDir = path.join(input.tasksRoot, input.taskId);
  const metaPath = path.join(taskDir, "meta.json");
  const splitPlanPath = path.join(taskDir, "split_plan.json");
  const meta = await readJson<Record<string, unknown>>(metaPath, {});
  const splitPlan = await readJson<Record<string, unknown>>(splitPlanPath, {});
  const previousBudgetLane = normalizeWorkerBudgetLane(extractObject(meta.worker_budget).budget_lane);
  const previousConvergence = extractObject(meta.worker_convergence);
  const view = buildWorkerRuntimeView({
    taskMeta: meta,
    splitPlan,
    taskDir,
    action: input.action,
    lane: input.lane,
    mode: input.mode,
    operation_id: input.operationId,
    dispatch_seq: input.dispatchSeq,
  });
  const summary = buildWorkerRuntimeMetaSummary(view, meta);
  const keeperQuery = buildSchedulerKeeperAssemblyQuery({
    taskMeta: meta,
    dispatch: view.dispatch,
    semantic: view.semantic,
    now: view.assembled_at,
  });
  const failurePatternSummary = buildWorkerFailurePatternSummary({ taskMeta: meta });
  await fs.mkdir(view.collaboration.workspace_root, { recursive: true });
  await fs.writeFile(path.join(taskDir, "worker_runtime_view.json"), `${JSON.stringify(view, null, 2)}\n`, "utf8");
  await writeJsonAtomic(path.join(taskDir, "scheduler_keeper_assembly_query.json"), keeperQuery);
  await writeJsonAtomic(path.join(taskDir, "worker_failure_pattern_summary.json"), failurePatternSummary);
  await updateTaskMeta(metaPath, (current) => {
    current.worker_runtime = summary.worker_runtime;
    current.worker_stage = summary.worker_stage;
    current.worker_budget = summary.worker_budget;
    current.worker_convergence =
      previousConvergence.convergence_class ||
      previousConvergence.remaining_work_estimate ||
      previousConvergence.reported_at
        ? {
            ...summary.worker_convergence,
            convergence_class: String(previousConvergence.convergence_class ?? summary.worker_convergence.convergence_class),
            convergence_confidence: Number(previousConvergence.convergence_confidence ?? summary.worker_convergence.convergence_confidence),
            progress_delta: Number(previousConvergence.progress_delta ?? summary.worker_convergence.progress_delta),
            remaining_work_estimate: String(previousConvergence.remaining_work_estimate ?? summary.worker_convergence.remaining_work_estimate),
            reclaim_reason: String(previousConvergence.reclaim_reason ?? summary.worker_convergence.reclaim_reason),
            reported_at: String(previousConvergence.reported_at ?? summary.worker_convergence.reported_at),
          }
        : summary.worker_convergence;
    current.task_cluster = summary.task_cluster;
    current.runtime_worker_control = summary.runtime_worker_control;
    current.keeper_feedback = summary.keeper_feedback;
    const scheduler = normalizeScheduler(current.scheduler);
    scheduler.knowledge_handoff = {
      keeper_query_path: "scheduler_keeper_assembly_query.json",
      failure_pattern_summary_path: "worker_failure_pattern_summary.json",
      failure_pattern_index_refs: view.dispatch.history_handoff.failure_pattern_index_refs,
      last_terminal_digest_path: scheduler.knowledge_handoff.last_terminal_digest_path,
      last_terminal_digest_observed_at: scheduler.knowledge_handoff.last_terminal_digest_observed_at,
    };
    current.scheduler = scheduler;
  });
  await input.runtime.runWhitelistedScript({
    repoRoot: input.runtime.repoRoot,
    scriptName: "append_task_event",
    args: [taskDir, "scheduler-ops", `${input.operationId}:runtime-assembled`, "WORKER_RUNTIME_ASSEMBLED", "worker_runtime_view_ready", String(meta.state ?? ""), String(meta.state ?? "")],
  });
  if (previousBudgetLane !== "degraded" && view.budget.budget_lane === "degraded") {
    await input.runtime.runWhitelistedScript({
      repoRoot: input.runtime.repoRoot,
      scriptName: "append_task_event",
      args: [taskDir, "scheduler-ops", `${input.operationId}:budget-degraded`, "WORKER_BUDGET_DEGRADED", "token_budget_exceeded_fast_lane", String(meta.state ?? ""), String(meta.state ?? "")],
    });
  }
  if (view.budget.budget_lane === "reclaim_pending") {
    await input.runtime.runWhitelistedScript({
      repoRoot: input.runtime.repoRoot,
      scriptName: "append_task_event",
      args: [taskDir, "scheduler-ops", `${input.operationId}:reclaim-requested`, "WORKER_RECLAIM_REQUESTED", "token_budget_reclaim_pending", String(meta.state ?? ""), String(meta.state ?? "")],
    });
  }
  if (summary.runtime_worker_control.rebuild_ready === true) {
    await input.runtime.runWhitelistedScript({
      repoRoot: input.runtime.repoRoot,
      scriptName: "append_task_event",
      args: [taskDir, "scheduler-ops", `${input.operationId}:rebuilt`, "WORKER_REBUILT_WITH_BUDGET", String(summary.runtime_worker_control.rebuild_reason ?? "budget_or_refinement_amendment"), String(meta.state ?? ""), String(meta.state ?? "")],
    });
  }
  await submitKeeperFeedbackCandidates({
    runtime: input.runtime,
    taskDir,
    taskId: input.taskId,
    metaPath,
    meta,
    view,
    summary,
    operationId: input.operationId,
  });
  return view;
}

function normalizeCandidateToken(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._/:@+=,-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 240);
}

async function submitKeeperFeedbackCandidates(input: {
  runtime: SchedulerToolRuntime;
  taskDir: string;
  taskId: string;
  metaPath: string;
  meta: Record<string, unknown>;
  view: WorkerRuntimeView;
  summary: ReturnType<typeof buildWorkerRuntimeMetaSummary>;
  operationId: string;
}): Promise<void> {
  const keeperFeedback = extractObject(input.summary.keeper_feedback);
  const feedbackTypes = Array.isArray(keeperFeedback.feedback_types)
    ? keeperFeedback.feedback_types.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (feedbackTypes.length === 0) {
    return;
  }
  const submittedFingerprints = new Set(
    Array.isArray(keeperFeedback.submitted_fingerprints)
      ? keeperFeedback.submitted_fingerprints.map((item) => String(item))
      : [],
  );
  const newlySubmitted: string[] = [];
  const newlySubmittedFingerprints: string[] = [];
  for (const feedbackType of feedbackTypes) {
    const fingerprint = buildKeeperFeedbackFingerprint({
      feedbackType: feedbackType as "capacity_allocation_feedback" | "refinement_quality_feedback",
      reason: String(keeperFeedback.reason ?? ""),
      projectId: input.view.semantic.project_id,
      componentCandidates: input.view.semantic.component_candidates,
      budgetLane: input.view.budget.budget_lane,
    });
    if (submittedFingerprints.has(fingerprint)) {
      continue;
    }
    await input.runtime.runWhitelistedScript({
      repoRoot: input.runtime.repoRoot,
      scriptName: "kb_submit_candidate",
      args: [
        input.taskId,
        "scheduler-ops",
        normalizeCandidateToken(`${feedbackType}_${input.view.task_id}`),
        normalizeCandidateToken(["worker-runtime-v2", feedbackType, input.view.dispatch.role_type, input.view.semantic.project_id].join(",")),
        normalizeCandidateToken(keeperFeedback.reason ? `${feedbackType}_${String(keeperFeedback.reason)}` : `${feedbackType}_worker_runtime_signal`),
        normalizeCandidateToken(
          feedbackType === "capacity_allocation_feedback"
            ? `raise_budget_or_rebuild_${input.view.budget.budget_lane}`
            : `refine_split_or_replan_${input.view.convergence.reclaim_reason || "stalled"}`,
        ),
        normalizeCandidateToken(input.view.semantic.component_candidates.join("_") || input.view.semantic.project_id || "generic"),
      ],
    });
    newlySubmitted.push(feedbackType);
    newlySubmittedFingerprints.push(fingerprint);
  }
  if (newlySubmitted.length === 0) {
    return;
  }
  await updateTaskMeta(input.metaPath, (current) => {
    const nextKeeperFeedback = extractObject(current.keeper_feedback);
    const nextSubmitted = new Set(
      Array.isArray(nextKeeperFeedback.submitted_candidates)
        ? nextKeeperFeedback.submitted_candidates.map((item) => String(item))
        : [],
    );
    const nextFingerprints = new Set(
      Array.isArray(nextKeeperFeedback.submitted_fingerprints)
        ? nextKeeperFeedback.submitted_fingerprints.map((item) => String(item))
        : [],
    );
    for (const entry of newlySubmitted) {
      nextSubmitted.add(entry);
    }
    for (const fingerprint of newlySubmittedFingerprints) {
      nextFingerprints.add(fingerprint);
    }
    current.keeper_feedback = {
      ...nextKeeperFeedback,
      ...input.summary.keeper_feedback,
      submitted_candidates: Array.from(nextSubmitted),
      submitted_fingerprints: Array.from(nextFingerprints),
      last_submitted_at: new Date().toISOString(),
    };
  });
  await input.runtime.runWhitelistedScript({
    repoRoot: input.runtime.repoRoot,
    scriptName: "append_task_event",
    args: [input.taskDir, "scheduler-ops", `${input.operationId}:keeper-feedback`, "KEEPER_FEEDBACK_CANDIDATE_SUBMITTED", normalizeCandidateToken(newlySubmitted.join("_")), String(input.meta.state ?? ""), String(input.meta.state ?? "")],
  });
}

export async function ensureRetryEvidence(tasksRoot: string, taskId: string): Promise<void> {
  const workPath = path.join(tasksRoot, taskId, "work.md");
  let content = "";
  try {
    content = await fs.readFile(workPath, "utf8");
  } catch {
    content = "";
  }
  const lines: string[] = [];
  if (!/retry|重试/i.test(content)) {
    lines.push("- Retry evidence: retry requested by scheduler kernel");
  }
  lines.push("- Latest action: retry requested by scheduler kernel");
  const next = `${content}${content.endsWith("\n") || content.length === 0 ? "" : "\n"}${lines.join("\n")}\n`;
  await fs.mkdir(path.dirname(workPath), { recursive: true });
  await fs.writeFile(workPath, next, "utf8");
}

export function normalizeWorkerBudgetLane(value: unknown): "fast" | "degraded" | "reclaim_pending" {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === "degraded" || raw === "reclaim_pending" ? raw : "fast";
}
