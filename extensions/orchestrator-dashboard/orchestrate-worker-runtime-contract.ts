import path from "node:path";

export const WORKER_BUDGET_LANE_TYPES = ["fast", "degraded", "reclaim_pending"] as const;
export const WORKER_CONVERGENCE_CLASSES = [
  "task_complete",
  "milestone_complete",
  "partial_deliverable",
  "stalled",
  "not_converged",
] as const;
export const WORKER_RECLAIM_REASONS = [
  "token_budget_exhausted",
  "stalled_no_effective_progress",
  "refinement_too_coarse",
  "refinement_too_fragmented",
  "dependency_blocked",
  "runtime_capability_insufficient",
] as const;
export const TASK_CLUSTER_MESSAGE_TYPES = [
  "partial_deliverable",
  "dependency_update",
  "handoff_note",
] as const;
export const TASK_CLUSTER_MESSAGE_STATUSES = [
  "published",
  "acknowledged",
  "consumed",
  "archived",
] as const;
export const WORKER_DELIVERY_MODES = ["deterministic_python_bundle", "unsupported_placeholder"] as const;
export const WORKER_KEEPER_FEEDBACK_TYPES = [
  "capacity_allocation_feedback",
  "refinement_quality_feedback",
] as const;

export type WorkerBudgetLaneType = (typeof WORKER_BUDGET_LANE_TYPES)[number];
export type WorkerConvergenceClass = (typeof WORKER_CONVERGENCE_CLASSES)[number];
export type WorkerReclaimReason = (typeof WORKER_RECLAIM_REASONS)[number];
export type TaskClusterMessageType = (typeof TASK_CLUSTER_MESSAGE_TYPES)[number];
export type TaskClusterMessageStatus = (typeof TASK_CLUSTER_MESSAGE_STATUSES)[number];
export type WorkerDeliveryMode = (typeof WORKER_DELIVERY_MODES)[number];
export type WorkerKeeperFeedbackType = (typeof WORKER_KEEPER_FEEDBACK_TYPES)[number];

export type WorkerTemplateSpec = {
  template_id: string;
  supported_role_types: WorkerDispatchContract["role_type"][];
  supported_component_candidates: string[];
  goal_matchers: string[];
  delivery_mode: WorkerDeliveryMode;
  role_default: boolean;
};

export type WorkerSemanticContract = {
  schema_version: "worker-semantic-contract-v1";
  task_id: string;
  goal: string;
  project_id: string;
  workspace_root: string;
  component_candidates: string[];
  refinement_scope: string;
  refinement_strategy: string;
  refinement_principle: string;
  dependency_hint_summary: {
    mode: string;
    roots: number;
    blocked: number;
    links: number;
    cross_module_links: number;
  };
  cluster_derivation_inputs: {
    project_id: string;
    workspace_root: string;
    component_candidates: string[];
  };
};

export type WorkerDispatchContract = {
  schema_version: "worker-dispatch-contract-v1";
  task_id: string;
  action: "dispatch" | "retry";
  lane: "assigned_ready" | "retry";
  mode: "local_threads" | "container" | "distributed";
  role_type: "worker-delivery" | "tester-ephemeral" | "audit-guard" | "unknown";
  operation_id: string;
  dispatch_seq: number;
  retry_count: number;
  queue_priority: number;
  budget_lane: WorkerBudgetLaneType;
};

export type WorkerBudgetContract = {
  schema_version: "worker-budget-contract-v1";
  task_id: string;
  max_token_cost: number;
  token_cost_used: number;
  fast_token_budget: number;
  degraded_token_budget: number;
  reclaim_threshold: number;
  budget_lane: WorkerBudgetLaneType;
};

export type WorkerConvergenceContract = {
  schema_version: "worker-convergence-contract-v1";
  task_id: string;
  convergence_class: WorkerConvergenceClass;
  convergence_confidence: number;
  progress_delta: number;
  remaining_work_estimate: string;
  reclaim_reason: WorkerReclaimReason | "";
  reported_at: string;
};

export type WorkerCollaborationContract = {
  schema_version: "worker-collaboration-contract-v1";
  task_id: string;
  cluster_id: string;
  memberships: string[];
  workspace_root: string;
  mailbox_path: string;
  archive_path: string;
  message_type_allowlist: TaskClusterMessageType[];
  default_target_role_types: string[];
  mailbox_counters: {
    published: number;
    acknowledged: number;
    consumed: number;
    archived: number;
  };
};

export type WorkerTemplateSelectorInput = {
  schema_version: "worker-template-selector-v1";
  role_type: WorkerDispatchContract["role_type"];
  component_candidates: string[];
  goal: string;
  preferred_template_ids: string[];
};

export type WorkerRuntimeView = {
  schema_version: "worker-runtime-view-v1";
  assembled_at: string;
  task_id: string;
  goal: string;
  workspace_root: string;
  run_root: string;
  work_domain_id: string;
  semantic: WorkerSemanticContract;
  dispatch: WorkerDispatchContract;
  budget: WorkerBudgetContract;
  convergence: WorkerConvergenceContract;
  collaboration: WorkerCollaborationContract;
  template_selector: WorkerTemplateSelectorInput;
};

export type WorkerRuntimeControlSummary = {
  budget_status: WorkerBudgetLaneType;
  reclaim_requested_at: string;
  rebuild_ready: boolean;
  rebuild_reason: string;
  last_rebuilt_at: string;
};

function extractObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = Math.floor(normalizeNumber(value, fallback));
  return parsed > 0 ? parsed : fallback;
}

function normalizeRatio(value: unknown, fallback: number): number {
  const parsed = normalizeNumber(value, fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

export function normalizeBudgetLane(value: unknown): WorkerBudgetLaneType {
  const raw = normalizeString(value);
  return WORKER_BUDGET_LANE_TYPES.includes(raw as WorkerBudgetLaneType)
    ? (raw as WorkerBudgetLaneType)
    : "fast";
}

export function normalizeConvergenceClass(value: unknown): WorkerConvergenceClass {
  const raw = normalizeString(value);
  return WORKER_CONVERGENCE_CLASSES.includes(raw as WorkerConvergenceClass)
    ? (raw as WorkerConvergenceClass)
    : "not_converged";
}

export function normalizeReclaimReason(value: unknown): WorkerReclaimReason | "" {
  const raw = normalizeString(value);
  return WORKER_RECLAIM_REASONS.includes(raw as WorkerReclaimReason)
    ? (raw as WorkerReclaimReason)
    : "";
}

export function normalizeMessageType(value: unknown): TaskClusterMessageType {
  const raw = normalizeString(value);
  return TASK_CLUSTER_MESSAGE_TYPES.includes(raw as TaskClusterMessageType)
    ? (raw as TaskClusterMessageType)
    : "partial_deliverable";
}

export function normalizeMailboxStatus(value: unknown): TaskClusterMessageStatus {
  const raw = normalizeString(value);
  return TASK_CLUSTER_MESSAGE_STATUSES.includes(raw as TaskClusterMessageStatus)
    ? (raw as TaskClusterMessageStatus)
    : "published";
}

export function normalizeKeeperFeedbackType(value: unknown): WorkerKeeperFeedbackType | "" {
  const raw = normalizeString(value);
  return WORKER_KEEPER_FEEDBACK_TYPES.includes(raw as WorkerKeeperFeedbackType)
    ? (raw as WorkerKeeperFeedbackType)
    : "";
}

export function deriveTaskClusterMemberships(params: {
  semantic: WorkerSemanticContract;
  dispatch: WorkerDispatchContract;
}): string[] {
  const roleMembership = `role:${params.dispatch.role_type}`;
  const projectMembership = `project:${params.semantic.project_id}`;
  const workspaceMembership = params.semantic.workspace_root
    ? `workspace:${params.semantic.workspace_root.replace(/[^A-Za-z0-9._/-]+/g, "_")}`
    : "";
  const componentMemberships = params.semantic.component_candidates.map((item) => `component:${item}`);
  return Array.from(
    new Set([roleMembership, projectMembership, workspaceMembership, ...componentMemberships].filter(Boolean)),
  );
}

export function deriveTaskClusterId(params: {
  semantic: WorkerSemanticContract;
  dispatch: WorkerDispatchContract;
}): string {
  const clusterIdRaw = [
    params.semantic.project_id || "prj_default",
    params.dispatch.role_type,
    params.semantic.component_candidates[0] || "generic",
  ]
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `cluster_${clusterIdRaw || "generic"}`;
}

export function normalizeMailboxCounters(value: unknown): WorkerCollaborationContract["mailbox_counters"] {
  const root = extractObject(value);
  return {
    published: Math.max(0, normalizePositiveInt(root.published, 0)),
    acknowledged: Math.max(0, normalizePositiveInt(root.acknowledged, 0)),
    consumed: Math.max(0, normalizePositiveInt(root.consumed, 0)),
    archived: Math.max(0, normalizePositiveInt(root.archived, 0)),
  };
}

export function buildWorkerRuntimeControlSummary(params: {
  previous?: Record<string, unknown>;
  budgetLane: WorkerBudgetLaneType;
  rebuildReason?: string;
  now: string;
}): WorkerRuntimeControlSummary {
  const previous = extractObject(params.previous);
  const previousBudgetStatus = normalizeBudgetLane(previous.budget_status);
  const reclaimRequestedAt =
    params.budgetLane === "reclaim_pending"
      ? normalizeString(previous.reclaim_requested_at, params.now)
      : "";
  const rebuildReady =
    previousBudgetStatus === "reclaim_pending" && params.budgetLane !== "reclaim_pending";
  return {
    budget_status: params.budgetLane,
    reclaim_requested_at: reclaimRequestedAt,
    rebuild_ready: rebuildReady,
    rebuild_reason: rebuildReady
      ? normalizeString(params.rebuildReason, "budget_or_refinement_amendment")
      : "",
    last_rebuilt_at: rebuildReady ? params.now : normalizeString(previous.last_rebuilt_at),
  };
}

export function buildKeeperFeedbackSummary(params: {
  view: WorkerRuntimeView;
  taskMeta: Record<string, unknown>;
}): Record<string, unknown> {
  const previous = extractObject(params.taskMeta.keeper_feedback);
  const feedbackTypes: WorkerKeeperFeedbackType[] = [];
  let keeperReason = "";
  if (params.view.budget.budget_lane === "reclaim_pending") {
    feedbackTypes.push("capacity_allocation_feedback");
    keeperReason = "token_budget_exhausted";
  }
  if (params.view.convergence.convergence_class === "stalled") {
    feedbackTypes.push("refinement_quality_feedback");
    keeperReason = params.view.convergence.reclaim_reason || keeperReason || "stalled_no_effective_progress";
  }
  return {
    feedback_types: feedbackTypes,
    last_feedback_at: feedbackTypes.length > 0 ? params.view.assembled_at : "",
    reason: keeperReason,
    submitted_candidates: Array.isArray(previous.submitted_candidates)
      ? previous.submitted_candidates
      : [],
    submitted_fingerprints: Array.isArray(previous.submitted_fingerprints)
      ? previous.submitted_fingerprints
      : [],
    last_submitted_at: normalizeString(previous.last_submitted_at),
  };
}

export function buildKeeperFeedbackFingerprint(params: {
  feedbackType: WorkerKeeperFeedbackType;
  reason: string;
  projectId: string;
  componentCandidates: string[];
  budgetLane: WorkerBudgetLaneType;
}): string {
  return [
    params.feedbackType,
    params.reason || "none",
    params.projectId || "prj_default",
    params.componentCandidates.join("+") || "generic",
    params.budgetLane,
  ]
    .map((item) =>
      normalizeString(item)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, ""),
    )
    .join("__");
}

export function buildWorkerTemplateRegistry(): WorkerTemplateSpec[] {
  return [
    {
      template_id: "websocket_calculator",
      supported_role_types: ["worker-delivery"],
      supported_component_candidates: ["websocket_calculator", "calculator_transport"],
      goal_matchers: ["websocket", "calculator"],
      delivery_mode: "deterministic_python_bundle",
      role_default: false,
    },
    {
      template_id: "placeholder_delivery",
      supported_role_types: ["worker-delivery"],
      supported_component_candidates: ["placeholder_delivery"],
      goal_matchers: ["placeholder_delivery"],
      delivery_mode: "unsupported_placeholder",
      role_default: false,
    },
    {
      template_id: "tester_placeholder",
      supported_role_types: ["tester-ephemeral"],
      supported_component_candidates: [],
      goal_matchers: [],
      delivery_mode: "unsupported_placeholder",
      role_default: true,
    },
  ];
}

export function matchWorkerTemplate(params: {
  selector: WorkerTemplateSelectorInput;
  registry?: WorkerTemplateSpec[];
}): WorkerTemplateSpec | null {
  const registry = params.registry ?? buildWorkerTemplateRegistry();
  const componentSet = new Set(params.selector.component_candidates.map((item) => normalizeString(item).toLowerCase()));
  const goal = normalizeString(params.selector.goal).toLowerCase();
  const preferred = new Set(params.selector.preferred_template_ids.map((item) => normalizeString(item)));
  const byId = registry.filter((template) => preferred.has(template.template_id));
  if (byId.length > 0) {
    return byId[0] ?? null;
  }
  const componentMatch = registry.find((template) =>
    template.supported_component_candidates.some((candidate) => componentSet.has(candidate.toLowerCase())),
  );
  if (componentMatch) {
    return componentMatch;
  }
  const roleMatch = registry.find(
    (template) =>
      template.role_default &&
      template.supported_role_types.includes(params.selector.role_type),
  );
  if (roleMatch) {
    return roleMatch;
  }
  return (
    registry.find((template) =>
      template.goal_matchers.length > 0 &&
      template.goal_matchers.every((matcher) => goal.includes(matcher.toLowerCase())),
    ) ?? null
  );
}

export function buildWorkerTemplateSelectorInput(params: {
  semantic: WorkerSemanticContract;
  dispatch: WorkerDispatchContract;
}): WorkerTemplateSelectorInput {
  const registry = buildWorkerTemplateRegistry();
  const preferredTemplateIds = registry
    .filter((template) =>
      template.supported_component_candidates.some((candidate) =>
        params.semantic.component_candidates.includes(candidate),
      ),
    )
    .map((template) => template.template_id);
  return {
    schema_version: "worker-template-selector-v1",
    role_type: params.dispatch.role_type,
    component_candidates: params.semantic.component_candidates,
    goal: params.semantic.goal,
    preferred_template_ids: preferredTemplateIds,
  };
}

export function buildWorkerSemanticContract(params: {
  taskMeta: Record<string, unknown>;
  splitPlan?: Record<string, unknown> | null;
}): WorkerSemanticContract {
  const planningDecision = extractObject(params.taskMeta.planning_decision);
  const workerRefinement = extractObject(planningDecision.worker_refinement);
  const splitPlan = extractObject(params.splitPlan);
  const refinementPartition = extractObject(splitPlan.refinement_partition);
  const dependencySummary = extractObject(refinementPartition.dependency_summary);
  const componentCandidatesSource = Array.isArray(refinementPartition.component_candidates)
    ? refinementPartition.component_candidates
    : Array.isArray(workerRefinement.component_candidates)
      ? workerRefinement.component_candidates
      : [];
  const componentCandidates = componentCandidatesSource
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
  const projectId = normalizeString(params.taskMeta.project_id, "prj_default");
  const workspaceRoot = normalizeString(params.taskMeta.workspace_root);

  return {
    schema_version: "worker-semantic-contract-v1",
    task_id: normalizeString(params.taskMeta.id, "task_unknown"),
    goal: normalizeString(params.taskMeta.goal),
    project_id: projectId,
    workspace_root: workspaceRoot,
    component_candidates: componentCandidates,
    refinement_scope: normalizeString(workerRefinement.refinement_scope, "single_meta_input"),
    refinement_strategy: normalizeString(
      workerRefinement.refinement_strategy,
      "linear_split_units_placeholder",
    ),
    refinement_principle: normalizeString(
      workerRefinement.primary_principle,
      "engineering_decoupling",
    ),
    dependency_hint_summary: {
      mode: normalizeString(dependencySummary.mode, "component_semantic_linearized"),
      roots: normalizePositiveInt(dependencySummary.roots, 0),
      blocked: normalizePositiveInt(dependencySummary.blocked, 0),
      links: normalizePositiveInt(dependencySummary.links, 0),
      cross_module_links: normalizePositiveInt(dependencySummary.cross_module_links, 0),
    },
    cluster_derivation_inputs: {
      project_id: projectId,
      workspace_root: workspaceRoot,
      component_candidates: componentCandidates,
    },
  };
}

export function buildWorkerBudgetContract(taskMeta: Record<string, unknown>): WorkerBudgetContract {
  const budget = extractObject(taskMeta.budget);
  const consumption = extractObject(taskMeta.consumption);
  const maxTokenCost = normalizePositiveInt(budget.max_token_cost, 50000);
  const tokenCostUsed = Math.max(0, normalizePositiveInt(consumption.token_cost_used, 0));
  const fastTokenBudget = maxTokenCost;
  const degradedTokenBudget = Math.max(fastTokenBudget + 1, Math.floor(maxTokenCost * 1.5));
  const reclaimThreshold = Math.max(degradedTokenBudget, Math.floor(maxTokenCost * 2));
  let budgetLane: WorkerBudgetLaneType = "fast";
  if (tokenCostUsed >= reclaimThreshold) {
    budgetLane = "reclaim_pending";
  } else if (tokenCostUsed >= fastTokenBudget) {
    budgetLane = "degraded";
  }

  return {
    schema_version: "worker-budget-contract-v1",
    task_id: normalizeString(taskMeta.id, "task_unknown"),
    max_token_cost: maxTokenCost,
    token_cost_used: tokenCostUsed,
    fast_token_budget: fastTokenBudget,
    degraded_token_budget: degradedTokenBudget,
    reclaim_threshold: reclaimThreshold,
    budget_lane: budgetLane,
  };
}

export function buildWorkerDispatchContract(params: {
  taskMeta: Record<string, unknown>;
  action: "dispatch" | "retry";
  lane: "assigned_ready" | "retry";
  mode: "local_threads" | "container" | "distributed";
  operation_id: string;
  dispatch_seq: number;
  budget_lane: WorkerBudgetLaneType;
}): WorkerDispatchContract {
  const scheduler = extractObject(params.taskMeta.scheduler);
  const rawRole = normalizeString(scheduler.agent_type, "unknown");
  const roleType: WorkerDispatchContract["role_type"] =
    rawRole === "worker-delivery" ||
    rawRole === "tester-ephemeral" ||
    rawRole === "audit-guard"
      ? rawRole
      : "unknown";
  return {
    schema_version: "worker-dispatch-contract-v1",
    task_id: normalizeString(params.taskMeta.id, "task_unknown"),
    action: params.action,
    lane: params.lane,
    mode: params.mode,
    role_type: roleType,
    operation_id: params.operation_id,
    dispatch_seq: Math.max(1, normalizePositiveInt(params.dispatch_seq, 1)),
    retry_count: Math.max(0, normalizePositiveInt(scheduler.retry_count, 0)),
    queue_priority: Math.max(0, normalizePositiveInt(scheduler.queue_priority, 0)),
    budget_lane: params.budget_lane,
  };
}

export function buildWorkerConvergenceContract(taskMeta: Record<string, unknown>): WorkerConvergenceContract {
  const root = extractObject(taskMeta.worker_convergence);
  return {
    schema_version: "worker-convergence-contract-v1",
    task_id: normalizeString(taskMeta.id, "task_unknown"),
    convergence_class: normalizeConvergenceClass(root.convergence_class),
    convergence_confidence: normalizeRatio(root.convergence_confidence, 0),
    progress_delta: Math.max(0, normalizePositiveInt(root.progress_delta, 0)),
    remaining_work_estimate: normalizeString(root.remaining_work_estimate),
    reclaim_reason: normalizeReclaimReason(root.reclaim_reason),
    reported_at: normalizeString(root.reported_at),
  };
}

export function buildWorkerCollaborationContract(params: {
  taskMeta: Record<string, unknown>;
  semantic: WorkerSemanticContract;
  taskDir: string;
  dispatch: WorkerDispatchContract;
}): WorkerCollaborationContract {
  const existing = extractObject(params.taskMeta.task_cluster);
  const memberships = deriveTaskClusterMemberships(params);
  const workspaceRoot = path.join(params.taskDir, "task_cluster_workspace");
  return {
    schema_version: "worker-collaboration-contract-v1",
    task_id: normalizeString(params.taskMeta.id, "task_unknown"),
    cluster_id: deriveTaskClusterId(params),
    memberships,
    workspace_root: workspaceRoot,
    mailbox_path: path.join(workspaceRoot, "mailbox.ndjson"),
    archive_path: path.join(workspaceRoot, "mailbox.archive.ndjson"),
    message_type_allowlist: [...TASK_CLUSTER_MESSAGE_TYPES],
    default_target_role_types:
      params.dispatch.role_type === "worker-delivery" ? ["tester-ephemeral"] : [],
    mailbox_counters: normalizeMailboxCounters(existing.mailbox_counters),
  };
}

export function buildWorkerRuntimeView(params: {
  taskMeta: Record<string, unknown>;
  splitPlan?: Record<string, unknown> | null;
  taskDir: string;
  action: "dispatch" | "retry";
  lane: "assigned_ready" | "retry";
  mode: "local_threads" | "container" | "distributed";
  operation_id: string;
  dispatch_seq: number;
  now?: string;
}): WorkerRuntimeView {
  const semantic = buildWorkerSemanticContract({
    taskMeta: params.taskMeta,
    splitPlan: params.splitPlan,
  });
  const budget = buildWorkerBudgetContract(params.taskMeta);
  const dispatch = buildWorkerDispatchContract({
    taskMeta: params.taskMeta,
    action: params.action,
    lane: params.lane,
    mode: params.mode,
    operation_id: params.operation_id,
    dispatch_seq: params.dispatch_seq,
    budget_lane: budget.budget_lane,
  });
  const convergence = buildWorkerConvergenceContract(params.taskMeta);
  const collaboration = buildWorkerCollaborationContract({
    taskMeta: params.taskMeta,
    semantic,
    taskDir: params.taskDir,
    dispatch,
  });
  const templateSelector = buildWorkerTemplateSelectorInput({
    semantic,
    dispatch,
  });
  return {
    schema_version: "worker-runtime-view-v1",
    assembled_at: params.now ?? new Date().toISOString(),
    task_id: normalizeString(params.taskMeta.id, "task_unknown"),
    goal: semantic.goal,
    workspace_root: semantic.workspace_root,
    run_root: normalizeString(params.taskMeta.run_root),
    work_domain_id: normalizeString(params.taskMeta.work_domain_id),
    semantic,
    dispatch,
    budget,
    convergence,
    collaboration,
    template_selector: templateSelector,
  };
}

export function buildWorkerRuntimeMetaSummary(
  view: WorkerRuntimeView,
  taskMeta?: Record<string, unknown>,
): {
  worker_runtime: Record<string, unknown>;
  worker_budget: Record<string, unknown>;
  worker_convergence: Record<string, unknown>;
  task_cluster: Record<string, unknown>;
  runtime_worker_control: Record<string, unknown>;
  keeper_feedback: Record<string, unknown>;
} {
  const runtimeControl = buildWorkerRuntimeControlSummary({
    previous: extractObject(taskMeta?.runtime_worker_control),
    budgetLane: view.budget.budget_lane,
    now: view.assembled_at,
  });
  return {
    worker_runtime: {
      schema_version: view.schema_version,
      assembled_at: view.assembled_at,
      role_type: view.dispatch.role_type,
      dispatch_action: view.dispatch.action,
      lane: view.dispatch.lane,
      mode: view.dispatch.mode,
      refinement_scope: view.semantic.refinement_scope,
      runtime_view_path: "worker_runtime_view.json",
      cluster_id: view.collaboration.cluster_id,
    },
    worker_budget: {
      budget_lane: view.budget.budget_lane,
      fast_token_budget: view.budget.fast_token_budget,
      degraded_token_budget: view.budget.degraded_token_budget,
      reclaim_threshold: view.budget.reclaim_threshold,
      token_cost_used: view.budget.token_cost_used,
      max_token_cost: view.budget.max_token_cost,
      updated_at: view.assembled_at,
    },
    worker_convergence: {
      convergence_class: view.convergence.convergence_class,
      convergence_confidence: view.convergence.convergence_confidence,
      progress_delta: view.convergence.progress_delta,
      remaining_work_estimate: view.convergence.remaining_work_estimate,
      reclaim_reason: view.convergence.reclaim_reason,
      reported_at: view.convergence.reported_at || view.assembled_at,
    },
    task_cluster: {
      cluster_id: view.collaboration.cluster_id,
      memberships: view.collaboration.memberships,
      workspace_root: view.collaboration.workspace_root,
      mailbox_path: view.collaboration.mailbox_path,
      archive_path: view.collaboration.archive_path,
      default_target_role_types: view.collaboration.default_target_role_types,
      mailbox_counters: view.collaboration.mailbox_counters,
      updated_at: view.assembled_at,
    },
    runtime_worker_control: runtimeControl,
    keeper_feedback: buildKeeperFeedbackSummary({ view, taskMeta: taskMeta ?? {} }),
  };
}
