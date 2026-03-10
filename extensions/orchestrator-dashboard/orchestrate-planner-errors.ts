export type PlannerContractErrorCode =
  | "MISSING_FIELD"
  | "TYPE_MISMATCH"
  | "DUPLICATE_LEAF_ID"
  | "MISSING_DEPENDENCY_LEAF"
  | "SELF_DEPENDENCY"
  | "FUTURE_DEPENDENCY"
  | "COMPONENT_DEPENDENCY_MISMATCH"
  | "INVALID_PARTITION_STRATEGY";

export class PlannerContractError extends Error {
  code: PlannerContractErrorCode;
  field: string;
  leaf_id?: string;
  dependency_leaf_id?: string;
  detail?: string;

  constructor(params: {
    code: PlannerContractErrorCode;
    field: string;
    detail?: string;
    leaf_id?: string;
    dependency_leaf_id?: string;
  }) {
    super(`[${params.code}] ${params.field}${params.detail ? `: ${params.detail}` : ""}`);
    this.name = "PlannerContractError";
    this.code = params.code;
    this.field = params.field;
    this.detail = params.detail;
    this.leaf_id = params.leaf_id;
    this.dependency_leaf_id = params.dependency_leaf_id;
  }
}

export function asPlannerContractError(error: unknown): PlannerContractError | null {
  return error instanceof PlannerContractError ? error : null;
}
