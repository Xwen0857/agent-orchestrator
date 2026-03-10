// Boundary rule:
// Do not add runtime logic here. This module must remain types + re-exports only.
export type PlannerDecisionSource = "manual_override" | "planner_llm" | "planner_rules_fallback";
export type PlannerPhase = "initial_plan" | "replan";
export type PlannerDecompositionStrategy = "single_path" | "module_first";
export type PlannerMetaDecompositionStrategy = "meta_single_unit" | "meta_module_partition";
export type PlannerRefinementScope = "single_meta_input" | "multi_meta_input";
export type PlannerReleasePolicy = "immediate_first_wave" | "rolling_followup";
export type PlannerDecouplingConfidence = "low" | "medium" | "high";

export type PlannerGranularityGuardrailPolicy = {
  mode: "soft";
  meta_units: {
    min: number;
    max: number;
  };
  leaf_units_per_meta: {
    min_meaningful_scope: "component_sized";
    max: number;
  };
  allow_agent_override_with_reason: boolean;
};

export type PlannerInitialPartitionModule = {
  module_id: string;
  module_title: string;
  rationale?: string;
  planned_leaf_count?: number;
  child_tasks: string[];
};

export type PlannerInitialPartition = {
  strategy: PlannerMetaDecompositionStrategy;
  modules: PlannerInitialPartitionModule[];
};

export type PlannerExecutionTarget = "local_threads" | "container" | "distributed";

export type PlannerAgentPolicy = {
  llm_role: "primary";
  token_priority: {
    tier: "highest";
    reserved_ratio: number;
    min_planning_tokens: number;
    max_planning_tokens: number;
    allow_inline_override: boolean;
  };
  mcp_soft_boundary: {
    mode: "bias_plan";
    include_namespace: boolean;
    include_read_only: boolean;
    include_profile_name: boolean;
    include_isolation_enabled: boolean;
  };
  granularity_guardrails: PlannerGranularityGuardrailPolicy;
};

export type PlannerExecutionTargets = {
  local_threads: {
    enabled: boolean;
  };
  container: {
    enabled: boolean;
    planner_transport: string;
  };
  distributed: {
    enabled: boolean;
    planner_transport: string;
    dispatch_endpoint: string;
  };
};

export type PlannerPolicyCompat = {
  allow_agent_runtime_fallback: boolean;
};

export type PlannerPolicyDocument = {
  schema_version: "planner-policy-v1";
  policy_id: string;
  updated_at: string;
  planner_agent: PlannerAgentPolicy;
  execution_targets: PlannerExecutionTargets;
  compat: PlannerPolicyCompat;
};

export type PlannerPolicyProvider = {
  loadPlannerPolicy: () => Promise<PlannerPolicyDocument>;
};

export type PlannerTokenPriorityContext = {
  tier: "highest";
  reserved_ratio: number;
  min_planning_tokens: number;
  max_planning_tokens: number;
  inline_override_applied: boolean;
  effective_planning_tokens: number;
};

export type PlannerMcpSoftBoundarySignals = {
  mode: "bias_plan";
  isolation_enabled: boolean;
  orchestrator_profile_name: string;
  project_profile_name: string;
  orchestrator_mcp_dir: string;
  project_mcp_dir: string;
  orchestrator_namespace_read_only: boolean;
  project_namespace_read_only: boolean;
};

export type PlannerMetaDecomposition = {
  decision_source: PlannerDecisionSource;
  decomposition_strategy: PlannerMetaDecompositionStrategy;
  meta_unit_count: number;
  primary_principle: "functional_decoupling";
  decoupling_confidence: PlannerDecouplingConfidence;
  decoupling_rationale: string[];
};

export type PlannerWorkerRefinement = {
  required: true;
  refinement_strategy: "linear_split_units_placeholder";
  refinement_scope: PlannerRefinementScope;
  primary_principle: "engineering_decoupling";
  component_candidates?: string[];
  refinement_rationale?: string[];
};

export type PlannerGranularityGuardrails = {
  mode: "soft";
  fragment_upper_bound: {
    max_meta_units: number;
    max_leaf_units_per_meta: number;
  };
  fragment_lower_bound: {
    min_meaningful_meta_units: number;
    min_meaningful_leaf_scope: "component_sized";
  };
  guardrail_triggered: boolean;
  guardrail_notes: string[];
};

export type PlannerDecision = {
  decision_source: PlannerDecisionSource;
  decision_reason: string;
  decision_signals: Record<string, unknown>;
  planner_phase?: PlannerPhase;
  decomposition_strategy?: PlannerDecompositionStrategy;
  release_policy?: PlannerReleasePolicy;
  request_authority?: "task_local_strategy_meta";
  llm_role?: "primary";
  llm_decision_used?: boolean;
  token_priority_context?: PlannerTokenPriorityContext;
  mcp_soft_boundary_signals?: PlannerMcpSoftBoundarySignals;
  meta_decomposition?: PlannerMetaDecomposition;
  worker_refinement?: PlannerWorkerRefinement;
  granularity_guardrails?: PlannerGranularityGuardrails;
  agent_contract_version?: "planner-core-v2";
};

export type PlannerRequestEnvelope = {
  schema_version: "planner-request-v1";
  request_id: string;
  task: {
    task_id: string;
    parent_task_id: string;
    task_goal: string;
  };
  source: {
    summary_input: Record<string, unknown>;
    budget: Record<string, unknown>;
    workspace: Record<string, unknown>;
  };
  policy: PlannerPolicyDocument;
  runtime_context: {
    agent_runtime_isolation: Record<string, unknown>;
    execution_target: PlannerExecutionTarget;
  };
  compat: {
    request_authority: "task_local_strategy_meta";
  };
};

export type PlannerDecisionEnvelope = {
  schema_version: "planner-decision-v1";
  decision_id: string;
  request_id: string;
  task_id: string;
  planner_decision: PlannerDecision;
  initial_partition: PlannerInitialPartition;
  split_plan_summary: Record<string, unknown>;
  apply_contract: {
    initial_partition: PlannerInitialPartition;
    worker_refinement?: PlannerWorkerRefinement;
    decomposition_strategy: string;
    release_policy: string;
  };
  execution_target: PlannerExecutionTarget;
  compat: {
    agent_contract_version?: "planner-core-v2";
  };
};

export type PlannerRequestView = {
  task_id: string;
  parent_task_id: string;
  task_goal: string;
  summary_input: Record<string, unknown>;
  budget: Record<string, unknown>;
  workspace: Record<string, unknown>;
  authority_input: "task_local_strategy_meta";
  planner_agent_policy: PlannerAgentPolicy;
  runtime_isolation: Record<string, unknown>;
  mcp_soft_boundary_context: Record<string, unknown>;
};

export type SplitPlan = {
  schema_version: "planner-split-plan-v1";
  task_id: string;
  planner_phase: string;
  decomposition_strategy: string;
  release_policy: string;
  initial_partition: PlannerInitialPartition;
  refinement_partition: PlannerRefinementPartition;
  decision_context: Record<string, unknown>;
};

export type PlannerLeafUnit = {
  leaf_id: string;
  module_id: string;
  module_title: string;
  component_candidate: string;
  depends_on_component_candidates: string[];
  depends_on_leaf_ids: string[];
  stage_id: string;
  sequence: number;
  total_units: number;
  release_state: string;
  worker_task_id?: string;
  child_task_id?: string;
};

export type PlannerRefinementPartition = {
  strategy: "linear_split_units_placeholder";
  input_scope: "single_meta_input" | "multi_meta_input";
  granularity: string;
  component_candidates: string[];
  leaf_units: PlannerLeafUnit[];
  dependency_summary: PlannerDependencySummary;
  backlog: unknown[];
};

export type PlannerDependencySummary = {
  mode: "component_semantic_linearized";
  roots: number;
  blocked: number;
  links: number;
  cross_module_links: number;
  note: string;
};

export {
  buildDefaultPlannerAgentPolicy,
  buildDefaultPlannerGranularityGuardrails,
  buildDefaultPlannerPolicyDocument,
  extractPlannerAgentPolicy,
  extractPlannerPolicyDocument,
} from "./orchestrate-planner-policy-contract.js";
export { extractPlannerDecision, extractPlannerDecisionEnvelope } from "./orchestrate-planner-decision-contract.js";
export { buildPlannerRequestEnvelope, buildPlannerRequestView } from "./orchestrate-planner-request-contract.js";
export {
  buildFallbackSplitPlan,
  extractSplitPlan,
  normalizeSplitPlanSchema,
  requireLeafUnits,
  validateRefinementPartitionLinks,
} from "./orchestrate-planner-split-plan-contract.js";
