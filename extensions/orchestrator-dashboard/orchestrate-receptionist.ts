import {
  applyMessageToDraft,
  appendSessionHistory,
  type OrchestrateSessionState,
} from "./orchestrate-session.js";

export type ReceptionistAmendmentScope =
  | "goal"
  | "constraints"
  | "deliverables"
  | "notes"
  | "workspace"
  | "budget";

export type ReceptionistAmendmentPatch = {
  op: "set" | "append" | "remove";
  value: string;
};

export type ReceptionistAmendmentItem = {
  id: string;
  created_at: string;
  scope: ReceptionistAmendmentScope;
  patch: ReceptionistAmendmentPatch;
  source: "user_message";
};

// Session-local capture buffer. This is not the planner's authority input anymore.
export type ReceptionistAmendmentQueue = {
  schema_version: "receptionist-amendment-queue-v1";
  session_key: string;
  task_id: string;
  status: "open" | "batched" | "flushed";
  window_started_at: string;
  updated_at: string;
  items: ReceptionistAmendmentItem[];
};

// Legacy compatibility payload retained for audit/export and v1 parity tests.
export type PlannerAmendmentBatch = {
  schema_version: "planner-amendment-batch-v1";
  session_key: string;
  task_id: string;
  created_at: string;
  from_window: {
    started_at: string;
    ended_at: string;
  };
  merged_changes: {
    task_goal_patch: ReceptionistAmendmentPatch | null;
    constraints_patch: ReceptionistAmendmentPatch[];
    deliverables_patch: ReceptionistAmendmentPatch[];
    notes_patch: ReceptionistAmendmentPatch[];
    workspace_patch: ReceptionistAmendmentPatch | null;
    budget_patch: ReceptionistAmendmentPatch | null;
  };
};

export const DEFAULT_RECEPTIONIST_AMENDMENT_WINDOW_MS = 30_000;
export const DEFAULT_AMENDMENT_RELEASE_MAX_WAIT_MS = 30_000;
export const DEFAULT_AMENDMENT_RELEASE_MAX_BATCH_COUNT = 8;

export type ReceptionistAmendmentLogEntryV2 = {
  entry_id: string;
  version: number;
  received_at: string;
  scope: ReceptionistAmendmentScope;
  patch: ReceptionistAmendmentPatch;
  source: "user_message";
  dedupe_basis: string;
};

export type ReceptionistAmendmentLogV2 = {
  schema_version: "receptionist-amendment-log-v2";
  session_key: string;
  task_id: string;
  head_version: number;
  entries: ReceptionistAmendmentLogEntryV2[];
  updated_at: string;
};

export type PlannerEffectivePatchConflictV2 = {
  field: "task_goal" | "workspace" | "budget";
  conflict_type: "multiple_candidates" | "invalid_value";
  basis: string;
  candidates: string[];
  chosen: string | null;
  source_versions: number[];
};

export type PlannerEffectivePatchV2 = {
  schema_version: "planner-effective-patch-v2";
  session_key: string;
  task_id: string;
  compiled_at: string;
  compiled_from_versions: {
    from_version: number;
    to_version: number;
  };
  effective_patch: PlannerAmendmentBatch["merged_changes"];
  source_versions: Record<ReceptionistAmendmentScope, number[]>;
  dedupe_basis: Record<ReceptionistAmendmentScope, string>;
  conflicts: PlannerEffectivePatchConflictV2[];
};

export type PlannerAmendmentWatermarkReleaseReasonV2 =
  | "wait_timeout"
  | "batch_count"
  | "manual_flush"
  | null;

export type PlannerAmendmentWatermarkV2 = {
  schema_version: "planner-amendment-watermark-v2";
  session_key: string;
  task_id: string;
  head_version: number;
  applying_version: number;
  consumed_version: number;
  last_release_reason: PlannerAmendmentWatermarkReleaseReasonV2;
  updated_at: string;
};

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function makeAmendmentId(index: number, now: string): string {
  return `amd_${now.replace(/[-:.TZ]/gu, "").slice(0, 14)}_${String(index + 1).padStart(3, "0")}`;
}

function buildDedupeBasis(scope: ReceptionistAmendmentScope, patch: ReceptionistAmendmentPatch): string {
  return `${scope}:${patch.op}:${patch.value.trim().toLowerCase()}`;
}

function parseWorkspaceRoot(value: string): string | null {
  const match = value.match(/workspace[_\s-]*root\s*[:=]\s*([A-Za-z0-9._/\-]+)/iu);
  return match?.[1]?.trim() || null;
}

function parseBudgetValue(value: string): string | null {
  const match = value.match(/budget\s*[:=]\s*([0-9]+)\s*,\s*([0-9]+)/iu);
  if (!match) {
    return null;
  }
  const tokenCost = Math.max(1, Number(match[1]));
  const executionSec = Math.max(1, Number(match[2]));
  if (!Number.isFinite(tokenCost) || !Number.isFinite(executionSec)) {
    return null;
  }
  return `budget: ${String(Math.floor(tokenCost))},${String(Math.floor(executionSec))}`;
}

export function inferReceptionistPendingQuestions(session: OrchestrateSessionState): string[] {
  const questions: string[] = [];
  if (!session.draft.task_goal.trim()) {
    questions.push("What should this task accomplish?");
  }
  if (!session.draft.project_id.trim()) {
    questions.push("Which project_id should this run attach to?");
  }
  if (!session.draft.workspace_root.trim()) {
    questions.push("Which workspace_root should the planner use?");
  }
  return questions;
}

export function applyReceptionistIntakeMessage(
  session: OrchestrateSessionState,
  message: string,
  options: { now?: string } = {},
): OrchestrateSessionState {
  const now = options.now ?? new Date().toISOString();
  const next = applyMessageToDraft(session, message, options);
  return {
    ...next,
    receptionist: {
      ...next.receptionist,
      active: true,
      pending_questions: inferReceptionistPendingQuestions(next),
      action_route: "intake_new_task",
      action_target_task_id: null,
      clarification_required: false,
      last_action_at: now,
    },
  };
}

export function buildReceptionistBriefing(params: {
  session: OrchestrateSessionState;
  queue?: ReceptionistAmendmentQueue | null;
  amendmentWatermark?: PlannerAmendmentWatermarkV2 | null;
  replan?: {
    status: string;
    impact: string;
    workerPolicy: string;
    executionStatus: string;
  } | null;
}): string {
  const { session, queue, amendmentWatermark, replan } = params;
  const pending = uniqueStrings(session.receptionist.pending_questions);
  const lines = [
    "orchestrate receptionist briefing",
    `session_key: ${session.session_key}`,
    `status: ${session.status}`,
    `task_goal: ${session.draft.task_goal || "(pending)"}`,
    `project_id: ${session.draft.project_id || "(pending)"}`,
    `workspace_root: ${session.draft.workspace_root || "(pending)"}`,
    `risk_level: ${session.draft.risk_level}`,
    "planner_ingress: auto-only",
    "initial_split_decision: planner-managed",
    `pending_questions: ${pending.join(" | ") || "(none)"}`,
  ];
  if (queue) {
    lines.push(`amendment_queue_status: ${queue.status}`);
    lines.push(`amendment_items: ${String(queue.items.length)}`);
  } else {
    lines.push("amendment_queue_status: (none)");
  }
  if (amendmentWatermark) {
    lines.push(`amendment_head_version: ${String(amendmentWatermark.head_version)}`);
    lines.push(`amendment_consumed_version: ${String(amendmentWatermark.consumed_version)}`);
    lines.push(`amendment_release_reason: ${amendmentWatermark.last_release_reason ?? "(none)"}`);
  }
  if (replan) {
    lines.push(`planner_replan_status: ${replan.status}`);
    lines.push(`planner_replan_impact: ${replan.impact}`);
    lines.push(`planner_replan_worker_policy: ${replan.workerPolicy}`);
    lines.push(`runtime_replan_consume_status: ${replan.executionStatus}`);
  }
  lines.push("planner remains isolated from raw user chat; only structured summary/batches are forwarded.");
  lines.push("users do not choose single/multi mode; planner-core decides the first-layer split.");
  return lines.join("\n");
}

export function buildReceptionistStartText(session: OrchestrateSessionState): string {
  return [
    "orchestrate receptionist mode activated",
    buildReceptionistBriefing({ session }),
    "",
    "describe the task, constraints, and configuration in normal language",
    "use /orchestrate summary for a briefing and structured summary",
    "use /orchestrate run when the intake is ready for planner handoff",
  ].join("\n");
}

function detectScope(message: string): {
  scope: ReceptionistAmendmentScope;
  op: ReceptionistAmendmentPatch["op"];
} {
  if (/workspace[_\s-]*root|工作区/u.test(message)) {
    return { scope: "workspace", op: "set" };
  }
  if (/budget|预算/u.test(message)) {
    return { scope: "budget", op: "set" };
  }
  if (/constraint|限制|不要|禁止/u.test(message)) {
    return { scope: "constraints", op: /remove|取消|移除/u.test(message) ? "remove" : "append" };
  }
  if (/deliverable|交付|产出/u.test(message)) {
    return { scope: "deliverables", op: /remove|取消|移除/u.test(message) ? "remove" : "append" };
  }
  if (/note|备注|说明/u.test(message)) {
    return { scope: "notes", op: "append" };
  }
  return { scope: "goal", op: "set" };
}

export function createReceptionistAmendmentItems(
  message: string,
  options: { now?: string; existingCount?: number } = {},
): ReceptionistAmendmentItem[] {
  const text = message.trim();
  if (!text) {
    return [];
  }
  const now = options.now ?? new Date().toISOString();
  const { scope, op } = detectScope(text);
  return [
    {
      id: makeAmendmentId(options.existingCount ?? 0, now),
      created_at: now,
      scope,
      patch: {
        op,
        value: text,
      },
      source: "user_message",
    },
  ];
}

export function buildInitialReceptionistAmendmentLogV2(params: {
  sessionKey: string;
  taskId: string;
  now?: string;
}): ReceptionistAmendmentLogV2 {
  const now = params.now ?? new Date().toISOString();
  return {
    schema_version: "receptionist-amendment-log-v2",
    session_key: params.sessionKey,
    task_id: params.taskId,
    head_version: 0,
    entries: [],
    updated_at: now,
  };
}

export function appendAmendmentEntriesToLogV2(params: {
  log: ReceptionistAmendmentLogV2 | null;
  sessionKey: string;
  taskId: string;
  items: ReceptionistAmendmentItem[];
  now?: string;
}): { log: ReceptionistAmendmentLogV2; appended: ReceptionistAmendmentLogEntryV2[] } {
  const now = params.now ?? new Date().toISOString();
  const baseLog =
    params.log ??
    buildInitialReceptionistAmendmentLogV2({
      sessionKey: params.sessionKey,
      taskId: params.taskId,
      now,
    });
  let nextVersion = Math.max(0, Number(baseLog.head_version) || 0);
  const appended = params.items.map((item) => {
    nextVersion += 1;
    return {
      entry_id: item.id,
      version: nextVersion,
      received_at: item.created_at,
      scope: item.scope,
      patch: { ...item.patch },
      source: item.source,
      dedupe_basis: buildDedupeBasis(item.scope, item.patch),
    };
  });
  return {
    log: {
      ...baseLog,
      session_key: params.sessionKey,
      task_id: params.taskId,
      head_version: nextVersion,
      entries: [...baseLog.entries, ...appended],
      updated_at: now,
    },
    appended,
  };
}

export function appendAmendmentItems(params: {
  session: OrchestrateSessionState;
  existingQueue: ReceptionistAmendmentQueue | null;
  message: string;
  now?: string;
}): { session: OrchestrateSessionState; queue: ReceptionistAmendmentQueue | null } {
  const now = params.now ?? new Date().toISOString();
  const baseQueue =
    params.existingQueue ??
    (params.session.last_run
      ? {
          schema_version: "receptionist-amendment-queue-v1" as const,
          session_key: params.session.session_key,
          task_id: params.session.last_run.task_id,
          status: "open" as const,
          window_started_at: now,
          updated_at: now,
          items: [],
        }
      : null);
  if (!baseQueue) {
    return { session: params.session, queue: null };
  }
  const newItems = createReceptionistAmendmentItems(params.message, {
    now,
    existingCount: baseQueue.items.length,
  });
  const queue =
    newItems.length === 0
      ? baseQueue
      : {
          ...baseQueue,
          status: "open" as const,
          updated_at: now,
          items: [...baseQueue.items, ...newItems],
        };
  const next = appendSessionHistory(
    {
      ...params.session,
      updated_at: now,
      receptionist: {
        ...params.session.receptionist,
        active: true,
        amendment_queue_open: queue.items.length > 0,
        action_route: "amend_existing_task",
        action_target_task_id: params.session.last_run?.task_id ?? null,
        clarification_required: false,
        last_action_at: now,
      },
    },
    {
      timestamp: now,
      role: "user",
      kind: "message",
      content: params.message.trim(),
    },
  );
  return { session: next, queue };
}

export function shouldFlushAmendmentQueue(
  queue: ReceptionistAmendmentQueue | null | undefined,
  options: { now?: string; windowMs?: number } = {},
): boolean {
  if (!queue || queue.items.length === 0) {
    return false;
  }
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  const startedMs = Date.parse(queue.window_started_at);
  if (!Number.isFinite(nowMs) || !Number.isFinite(startedMs)) {
    return false;
  }
  return nowMs - startedMs >= (options.windowMs ?? DEFAULT_RECEPTIONIST_AMENDMENT_WINDOW_MS);
}

export function buildInitialPlannerAmendmentWatermarkV2(params: {
  sessionKey: string;
  taskId: string;
  now?: string;
}): PlannerAmendmentWatermarkV2 {
  const now = params.now ?? new Date().toISOString();
  return {
    schema_version: "planner-amendment-watermark-v2",
    session_key: params.sessionKey,
    task_id: params.taskId,
    head_version: 0,
    applying_version: 0,
    consumed_version: 0,
    last_release_reason: null,
    updated_at: now,
  };
}

export function compilePlannerEffectivePatchV2(params: {
  log: ReceptionistAmendmentLogV2;
  fromVersion?: number;
  toVersion?: number;
  now?: string;
}): PlannerEffectivePatchV2 {
  const now = params.now ?? new Date().toISOString();
  const fromVersion = Math.max(1, Math.floor(params.fromVersion ?? 1));
  const toVersion = Math.max(fromVersion - 1, Math.floor(params.toVersion ?? params.log.head_version));
  const scopedEntries = params.log.entries.filter(
    (entry) => entry.version >= fromVersion && entry.version <= toVersion,
  );
  const byScope = (scope: ReceptionistAmendmentScope): ReceptionistAmendmentLogEntryV2[] =>
    scopedEntries.filter((entry) => entry.scope === scope);
  const sourceVersions: Record<ReceptionistAmendmentScope, number[]> = {
    goal: byScope("goal").map((entry) => entry.version),
    constraints: byScope("constraints").map((entry) => entry.version),
    deliverables: byScope("deliverables").map((entry) => entry.version),
    notes: byScope("notes").map((entry) => entry.version),
    workspace: byScope("workspace").map((entry) => entry.version),
    budget: byScope("budget").map((entry) => entry.version),
  };
  const dedupe_basis: Record<ReceptionistAmendmentScope, string> = {
    goal: "last_write_wins",
    constraints: "set_union_minus_remove",
    deliverables: "set_union_minus_remove",
    notes: "dedupe_append",
    workspace: "last_valid_set",
    budget: "last_valid_set",
  };
  const conflicts: PlannerEffectivePatchConflictV2[] = [];

  const resolveLastSet = (scope: "goal" | "workspace" | "budget"): ReceptionistAmendmentPatch | null => {
    const candidates = byScope(scope)
      .filter((entry) => entry.patch.op === "set")
      .map((entry) => ({
        value: entry.patch.value.trim(),
        version: entry.version,
      }))
      .filter((entry) => Boolean(entry.value));
    if (candidates.length === 0) {
      return null;
    }
    const uniqueCandidateValues = uniqueStrings(candidates.map((candidate) => candidate.value));
    if (uniqueCandidateValues.length > 1) {
      const latest = candidates[candidates.length - 1] ?? null;
      conflicts.push({
        field: scope === "goal" ? "task_goal" : scope,
        conflict_type: "multiple_candidates",
        basis: "last_write_wins",
        candidates: uniqueCandidateValues,
        chosen: latest?.value ?? null,
        source_versions: candidates.map((candidate) => candidate.version),
      });
    }
    if (scope === "workspace") {
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        const normalized = parseWorkspaceRoot(candidate?.value ?? "");
        if (normalized) {
          return { op: "set", value: `workspace-root: ${normalized}` };
        }
      }
      conflicts.push({
        field: "workspace",
        conflict_type: "invalid_value",
        basis: "workspace_root_parse_failed",
        candidates: uniqueCandidateValues,
        chosen: null,
        source_versions: candidates.map((candidate) => candidate.version),
      });
      return null;
    }
    if (scope === "budget") {
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        const normalized = parseBudgetValue(candidate?.value ?? "");
        if (normalized) {
          return { op: "set", value: normalized };
        }
      }
      conflicts.push({
        field: "budget",
        conflict_type: "invalid_value",
        basis: "budget_parse_failed",
        candidates: uniqueCandidateValues,
        chosen: null,
        source_versions: candidates.map((candidate) => candidate.version),
      });
      return null;
    }
    return { op: "set", value: candidates[candidates.length - 1]?.value ?? "" };
  };

  return {
    schema_version: "planner-effective-patch-v2",
    session_key: params.log.session_key,
    task_id: params.log.task_id,
    compiled_at: now,
    compiled_from_versions: {
      from_version: fromVersion,
      to_version: toVersion,
    },
    effective_patch: {
      task_goal_patch: resolveLastSet("goal"),
      constraints_patch: mergeListPatches(byScope("constraints").map((entry) => ({
        id: entry.entry_id,
        created_at: entry.received_at,
        scope: entry.scope,
        patch: entry.patch,
        source: entry.source,
      }))),
      deliverables_patch: mergeListPatches(byScope("deliverables").map((entry) => ({
        id: entry.entry_id,
        created_at: entry.received_at,
        scope: entry.scope,
        patch: entry.patch,
        source: entry.source,
      }))),
      notes_patch: uniqueStrings(byScope("notes").map((entry) => entry.patch.value.trim())).map((value) => ({
        op: "append",
        value,
      })),
      workspace_patch: resolveLastSet("workspace"),
      budget_patch: resolveLastSet("budget"),
    },
    source_versions: sourceVersions,
    dedupe_basis,
    conflicts,
  };
}

export function shouldReleasePlannerEffectivePatch(params: {
  log: ReceptionistAmendmentLogV2 | null;
  watermark: PlannerAmendmentWatermarkV2 | null;
  now?: string;
  maxWaitMs?: number;
  maxBatchCount?: number;
  manualFlush?: boolean;
}): {
  should_release: boolean;
  reason: PlannerAmendmentWatermarkReleaseReasonV2;
  pending_count: number;
  wait_ms: number;
} {
  const nowMs = Date.parse(params.now ?? new Date().toISOString());
  if (!params.log || params.log.head_version <= 0 || !Number.isFinite(nowMs)) {
    return { should_release: false, reason: null, pending_count: 0, wait_ms: 0 };
  }
  const consumedVersion = Math.max(0, params.watermark?.consumed_version ?? 0);
  const applyingVersion = Math.max(0, params.watermark?.applying_version ?? 0);
  const headVersion = Math.max(params.log.head_version, params.watermark?.head_version ?? 0);
  const pendingCount = Math.max(0, headVersion - consumedVersion);
  if (pendingCount <= 0 || applyingVersion > consumedVersion) {
    return { should_release: false, reason: null, pending_count: pendingCount, wait_ms: 0 };
  }
  if (params.manualFlush) {
    return { should_release: true, reason: "manual_flush", pending_count: pendingCount, wait_ms: 0 };
  }
  const firstPending = params.log.entries.find((entry) => entry.version > consumedVersion) ?? null;
  const firstPendingMs = firstPending ? Date.parse(firstPending.received_at) : Number.NaN;
  const waitMs = Number.isFinite(firstPendingMs) ? Math.max(0, nowMs - firstPendingMs) : 0;
  if (pendingCount >= (params.maxBatchCount ?? DEFAULT_AMENDMENT_RELEASE_MAX_BATCH_COUNT)) {
    return { should_release: true, reason: "batch_count", pending_count: pendingCount, wait_ms: waitMs };
  }
  if (waitMs >= (params.maxWaitMs ?? DEFAULT_AMENDMENT_RELEASE_MAX_WAIT_MS)) {
    return { should_release: true, reason: "wait_timeout", pending_count: pendingCount, wait_ms: waitMs };
  }
  return { should_release: false, reason: null, pending_count: pendingCount, wait_ms: waitMs };
}

export function markPlannerAmendmentApplyingV2(params: {
  watermark: PlannerAmendmentWatermarkV2 | null;
  sessionKey: string;
  taskId: string;
  headVersion: number;
  reason: Exclude<PlannerAmendmentWatermarkReleaseReasonV2, null>;
  now?: string;
}): PlannerAmendmentWatermarkV2 {
  const now = params.now ?? new Date().toISOString();
  const base =
    params.watermark ??
    buildInitialPlannerAmendmentWatermarkV2({
      sessionKey: params.sessionKey,
      taskId: params.taskId,
      now,
    });
  const targetVersion = Math.max(base.consumed_version, params.headVersion);
  return {
    ...base,
    session_key: params.sessionKey,
    task_id: params.taskId,
    head_version: Math.max(base.head_version, params.headVersion),
    applying_version: targetVersion,
    last_release_reason: params.reason,
    updated_at: now,
  };
}

export function markPlannerAmendmentConsumedV2(params: {
  watermark: PlannerAmendmentWatermarkV2;
  now?: string;
}): PlannerAmendmentWatermarkV2 {
  const now = params.now ?? new Date().toISOString();
  const consumedVersion = Math.max(
    params.watermark.consumed_version,
    params.watermark.applying_version,
    params.watermark.head_version,
  );
  return {
    ...params.watermark,
    consumed_version: consumedVersion,
    applying_version: consumedVersion,
    updated_at: now,
  };
}

function mergeListPatches(items: ReceptionistAmendmentItem[]): ReceptionistAmendmentPatch[] {
  const removals = new Set(
    items
      .filter((item) => item.patch.op === "remove")
      .map((item) => item.patch.value.trim())
      .filter(Boolean),
  );
  return uniqueStrings(
    items
      .filter((item) => item.patch.op !== "remove")
      .map((item) => item.patch.value.trim())
      .filter((value) => value && !removals.has(value)),
  ).map((value) => ({
    op: "append" as const,
    value,
  }));
}

export function buildPlannerAmendmentBatch(
  queue: ReceptionistAmendmentQueue,
  options: { now?: string } = {},
): PlannerAmendmentBatch {
  const now = options.now ?? new Date().toISOString();
  const byScope = (scope: ReceptionistAmendmentScope): ReceptionistAmendmentItem[] =>
    queue.items.filter((item) => item.scope === scope);
  const lastSet = (scope: "goal" | "workspace" | "budget"): ReceptionistAmendmentPatch | null => {
    const matches = byScope(scope).filter((item) => item.patch.op === "set");
    const last = matches[matches.length - 1];
    return last ? { ...last.patch } : null;
  };
  return {
    schema_version: "planner-amendment-batch-v1",
    session_key: queue.session_key,
    task_id: queue.task_id,
    created_at: now,
    from_window: {
      started_at: queue.window_started_at,
      ended_at: now,
    },
    merged_changes: {
      task_goal_patch: lastSet("goal"),
      constraints_patch: mergeListPatches(byScope("constraints")),
      deliverables_patch: mergeListPatches(byScope("deliverables")),
      notes_patch: uniqueStrings(byScope("notes").map((item) => item.patch.value.trim())).map((value) => ({
        op: "append" as const,
        value,
      })),
      workspace_patch: lastSet("workspace"),
      budget_patch: lastSet("budget"),
    },
  };
}
