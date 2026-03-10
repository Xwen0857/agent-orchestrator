import { buildSessionFileStem } from "./orchestrate-session.js";
import type {
  PlannerAmendmentWatermarkV2,
  PlannerEffectivePatchV2,
  ReceptionistAmendmentLogEntryV2,
  ReceptionistAmendmentLogV2,
  ReceptionistAmendmentItem,
  ReceptionistAmendmentQueue,
} from "./orchestrate-receptionist.js";
import type { OrchestrateStateIo } from "./orchestrate-state.js";
import path from "node:path";

export type ReceptionistStatePaths = {
  orchestrateAmendmentsDir: string;
  orchestrateAmendmentBatchesDir: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeQueue(
  raw: unknown,
  fallback: ReceptionistAmendmentQueue,
): ReceptionistAmendmentQueue {
  const record = asRecord(raw) ?? {};
  const itemsRaw = Array.isArray(record.items) ? record.items : [];
  return {
    schema_version: "receptionist-amendment-queue-v1",
    session_key: normalizeString(record.session_key, fallback.session_key),
    task_id: normalizeString(record.task_id, fallback.task_id),
    status:
      normalizeString(record.status, fallback.status) === "batched"
        ? "batched"
        : normalizeString(record.status, fallback.status) === "flushed"
          ? "flushed"
          : "open",
    window_started_at: normalizeString(record.window_started_at, fallback.window_started_at),
    updated_at: normalizeString(record.updated_at, fallback.updated_at),
    items: itemsRaw
      .map((item) => {
        const row = asRecord(item) ?? {};
        const patch = asRecord(row.patch) ?? {};
        const scope = normalizeString(row.scope, "notes");
        const normalizedScope: ReceptionistAmendmentItem["scope"] =
          scope === "goal" ||
          scope === "constraints" ||
          scope === "deliverables" ||
          scope === "workspace" ||
          scope === "budget"
            ? scope
            : ("notes" as const);
        const normalizedOp: ReceptionistAmendmentItem["patch"]["op"] =
          normalizeString(patch.op, "append") === "set"
            ? "set"
            : normalizeString(patch.op, "append") === "remove"
              ? "remove"
              : "append";
        return {
          id: normalizeString(row.id),
          created_at: normalizeString(row.created_at, fallback.updated_at),
          scope: normalizedScope,
          patch: {
            op: normalizedOp,
            value: normalizeString(patch.value),
          },
          source: "user_message" as const,
        };
      })
      .filter((item) => item.id && item.patch.value),
  };
}

function normalizeLogEntryV2(raw: unknown, fallbackTime: string): ReceptionistAmendmentLogEntryV2 | null {
  const row = asRecord(raw) ?? {};
  const patch = asRecord(row.patch) ?? {};
  const scope = normalizeString(row.scope, "notes");
  const normalizedScope: ReceptionistAmendmentLogEntryV2["scope"] =
    scope === "goal" ||
    scope === "constraints" ||
    scope === "deliverables" ||
    scope === "workspace" ||
    scope === "budget"
      ? scope
      : ("notes" as const);
  const normalizedOp: ReceptionistAmendmentLogEntryV2["patch"]["op"] =
    normalizeString(patch.op, "append") === "set"
      ? "set"
      : normalizeString(patch.op, "append") === "remove"
        ? "remove"
        : "append";
  const version = Math.max(0, Math.floor(Number(row.version) || 0));
  const entryId = normalizeString(row.entry_id);
  const value = normalizeString(patch.value);
  if (!entryId || !value || version <= 0) {
    return null;
  }
  return {
    entry_id: entryId,
    version,
    received_at: normalizeString(row.received_at, fallbackTime),
    scope: normalizedScope,
    patch: {
      op: normalizedOp,
      value,
    },
    source: "user_message",
    dedupe_basis: normalizeString(row.dedupe_basis, `${normalizedScope}:${normalizedOp}:${value.toLowerCase()}`),
  };
}

function normalizeLogV2(
  raw: unknown,
  fallback: ReceptionistAmendmentLogV2,
): ReceptionistAmendmentLogV2 {
  const record = asRecord(raw) ?? {};
  const entriesRaw = Array.isArray(record.entries) ? record.entries : [];
  const entries = entriesRaw
    .map((entry) => normalizeLogEntryV2(entry, fallback.updated_at))
    .filter((entry): entry is ReceptionistAmendmentLogEntryV2 => Boolean(entry))
    .sort((a, b) => a.version - b.version);
  const headVersion = Math.max(
    Number(record.head_version) || 0,
    entries[entries.length - 1]?.version ?? 0,
  );
  return {
    schema_version: "receptionist-amendment-log-v2",
    session_key: normalizeString(record.session_key, fallback.session_key),
    task_id: normalizeString(record.task_id, fallback.task_id),
    head_version: Math.max(0, Math.floor(headVersion)),
    entries,
    updated_at: normalizeString(record.updated_at, fallback.updated_at),
  };
}

function normalizeEffectivePatchV2(
  raw: unknown,
  fallback: PlannerEffectivePatchV2,
): PlannerEffectivePatchV2 {
  const record = asRecord(raw) ?? {};
  const compiledFrom = asRecord(record.compiled_from_versions) ?? {};
  const effectivePatch = asRecord(record.effective_patch) ?? {};
  const sourceVersionsRecord = asRecord(record.source_versions) ?? {};
  const dedupeBasisRecord = asRecord(record.dedupe_basis) ?? {};
  const normalizePatch = (value: unknown): ReceptionistAmendmentItem["patch"] | null => {
    const patch = asRecord(value) ?? {};
    const op = normalizeString(patch.op, "");
    if (op !== "set" && op !== "append" && op !== "remove") {
      return null;
    }
    const patchValue = normalizeString(patch.value);
    if (!patchValue) {
      return null;
    }
    return {
      op,
      value: patchValue,
    };
  };
  const normalizePatchList = (value: unknown): ReceptionistAmendmentItem["patch"][] =>
    (Array.isArray(value) ? value : [])
      .map((item) => normalizePatch(item))
      .filter((item): item is ReceptionistAmendmentItem["patch"] => Boolean(item));
  const scopes: Array<keyof PlannerEffectivePatchV2["source_versions"]> = [
    "goal",
    "constraints",
    "deliverables",
    "notes",
    "workspace",
    "budget",
  ];
  const sourceVersions = scopes.reduce((acc, scope) => {
    const values = Array.isArray(sourceVersionsRecord[scope]) ? (sourceVersionsRecord[scope] as unknown[]) : [];
    acc[scope] = values
      .map((value) => Math.max(0, Math.floor(Number(value) || 0)))
      .filter((value) => value > 0);
    return acc;
  }, {} as PlannerEffectivePatchV2["source_versions"]);
  const dedupeBasis = scopes.reduce((acc, scope) => {
    acc[scope] = normalizeString(dedupeBasisRecord[scope], fallback.dedupe_basis[scope]);
    return acc;
  }, {} as PlannerEffectivePatchV2["dedupe_basis"]);
  const conflictsRaw = Array.isArray(record.conflicts) ? record.conflicts : [];
  const conflicts: PlannerEffectivePatchV2["conflicts"] = conflictsRaw
    .map((value) => {
      const row = asRecord(value) ?? {};
      const field = normalizeString(row.field, "");
      const conflictType = normalizeString(row.conflict_type, "");
      if (
        (field !== "task_goal" && field !== "workspace" && field !== "budget") ||
        (conflictType !== "multiple_candidates" && conflictType !== "invalid_value")
      ) {
        return null;
      }
      const chosenValue =
        typeof row.chosen === "string" && row.chosen.trim() ? row.chosen.trim() : null;
      return {
        field,
        conflict_type: conflictType,
        basis: normalizeString(row.basis, "unknown"),
        candidates: (Array.isArray(row.candidates) ? row.candidates : [])
          .map((candidate) => normalizeString(candidate))
          .filter(Boolean),
        chosen: chosenValue,
        source_versions: (Array.isArray(row.source_versions) ? row.source_versions : [])
          .map((version) => Math.max(0, Math.floor(Number(version) || 0)))
          .filter((version) => version > 0),
      };
    })
    .filter((conflict): conflict is PlannerEffectivePatchV2["conflicts"][number] => Boolean(conflict));
  return {
    schema_version: "planner-effective-patch-v2",
    session_key: normalizeString(record.session_key, fallback.session_key),
    task_id: normalizeString(record.task_id, fallback.task_id),
    compiled_at: normalizeString(record.compiled_at, fallback.compiled_at),
    compiled_from_versions: {
      from_version: Math.max(0, Math.floor(Number(compiledFrom.from_version) || fallback.compiled_from_versions.from_version)),
      to_version: Math.max(0, Math.floor(Number(compiledFrom.to_version) || fallback.compiled_from_versions.to_version)),
    },
    effective_patch: {
      task_goal_patch: normalizePatch(effectivePatch.task_goal_patch),
      constraints_patch: normalizePatchList(effectivePatch.constraints_patch),
      deliverables_patch: normalizePatchList(effectivePatch.deliverables_patch),
      notes_patch: normalizePatchList(effectivePatch.notes_patch),
      workspace_patch: normalizePatch(effectivePatch.workspace_patch),
      budget_patch: normalizePatch(effectivePatch.budget_patch),
    },
    source_versions: sourceVersions,
    dedupe_basis: dedupeBasis,
    conflicts,
  };
}

function normalizeWatermarkV2(
  raw: unknown,
  fallback: PlannerAmendmentWatermarkV2,
): PlannerAmendmentWatermarkV2 {
  const record = asRecord(raw) ?? {};
  const normalizeVersion = (value: unknown, fallbackValue: number): number =>
    Math.max(0, Math.floor(Number(value) || fallbackValue));
  const releaseReason = normalizeString(record.last_release_reason, "");
  return {
    schema_version: "planner-amendment-watermark-v2",
    session_key: normalizeString(record.session_key, fallback.session_key),
    task_id: normalizeString(record.task_id, fallback.task_id),
    head_version: normalizeVersion(record.head_version, fallback.head_version),
    applying_version: normalizeVersion(record.applying_version, fallback.applying_version),
    consumed_version: normalizeVersion(record.consumed_version, fallback.consumed_version),
    last_release_reason:
      releaseReason === "wait_timeout" || releaseReason === "batch_count" || releaseReason === "manual_flush"
        ? releaseReason
        : null,
    updated_at: normalizeString(record.updated_at, fallback.updated_at),
  };
}

export function buildReceptionistAmendmentQueuePath(
  paths: ReceptionistStatePaths,
  sessionKey: string,
): string {
  return path.join(paths.orchestrateAmendmentsDir, `${buildSessionFileStem(sessionKey)}.json`);
}

export function buildReceptionistAmendmentLogV2Path(
  paths: ReceptionistStatePaths,
  sessionKey: string,
): string {
  return path.join(paths.orchestrateAmendmentsDir, `${buildSessionFileStem(sessionKey)}.log.v2.json`);
}

export function buildPlannerEffectivePatchV2Path(
  paths: ReceptionistStatePaths,
  sessionKey: string,
): string {
  return path.join(paths.orchestrateAmendmentBatchesDir, `${buildSessionFileStem(sessionKey)}.effective-patch.v2.json`);
}

export function buildPlannerAmendmentWatermarkV2Path(
  paths: ReceptionistStatePaths,
  sessionKey: string,
): string {
  return path.join(paths.orchestrateAmendmentBatchesDir, `${buildSessionFileStem(sessionKey)}.watermark.v2.json`);
}

export async function readReceptionistAmendmentQueueStore(params: {
  io: OrchestrateStateIo;
  paths: ReceptionistStatePaths;
  sessionKey: string;
  taskId: string;
}): Promise<ReceptionistAmendmentQueue | null> {
  if (!params.sessionKey || !params.taskId) {
    return null;
  }
  const target = buildReceptionistAmendmentQueuePath(params.paths, params.sessionKey);
  if (!(await params.io.fileExists(target))) {
    return null;
  }
  const now = new Date().toISOString();
  const fallback: ReceptionistAmendmentQueue = {
    schema_version: "receptionist-amendment-queue-v1",
    session_key: params.sessionKey,
    task_id: params.taskId,
    status: "open",
    window_started_at: now,
    updated_at: now,
    items: [],
  };
  const raw = await params.io.readJsonOrDefault<Record<string, unknown>>(target, fallback);
  return normalizeQueue(raw, fallback);
}

export async function writeReceptionistAmendmentQueueStore(params: {
  io: OrchestrateStateIo;
  paths: ReceptionistStatePaths;
  queue: ReceptionistAmendmentQueue;
}): Promise<void> {
  await params.io.writeJsonAtomic(
    buildReceptionistAmendmentQueuePath(params.paths, params.queue.session_key),
    params.queue,
  );
}

export async function writeReceptionistAmendmentLogV2Store(params: {
  io: OrchestrateStateIo;
  paths: ReceptionistStatePaths;
  log: ReceptionistAmendmentLogV2;
}): Promise<void> {
  await params.io.writeJsonAtomic(
    buildReceptionistAmendmentLogV2Path(params.paths, params.log.session_key),
    params.log,
  );
}

export async function readReceptionistAmendmentLogV2Store(params: {
  io: OrchestrateStateIo;
  paths: ReceptionistStatePaths;
  sessionKey: string;
  taskId: string;
}): Promise<ReceptionistAmendmentLogV2 | null> {
  if (!params.sessionKey || !params.taskId) {
    return null;
  }
  const target = buildReceptionistAmendmentLogV2Path(params.paths, params.sessionKey);
  if (!(await params.io.fileExists(target))) {
    return null;
  }
  const now = new Date().toISOString();
  const fallback: ReceptionistAmendmentLogV2 = {
    schema_version: "receptionist-amendment-log-v2",
    session_key: params.sessionKey,
    task_id: params.taskId,
    head_version: 0,
    entries: [],
    updated_at: now,
  };
  const raw = await params.io.readJsonOrDefault<Record<string, unknown>>(target, fallback);
  return normalizeLogV2(raw, fallback);
}

export async function writePlannerEffectivePatchV2Store(params: {
  io: OrchestrateStateIo;
  paths: ReceptionistStatePaths;
  patch: PlannerEffectivePatchV2;
}): Promise<string> {
  const patchPath = buildPlannerEffectivePatchV2Path(params.paths, params.patch.session_key);
  await params.io.writeJsonAtomic(patchPath, params.patch);
  return patchPath;
}

export async function readPlannerEffectivePatchV2Store(params: {
  io: OrchestrateStateIo;
  paths: ReceptionistStatePaths;
  sessionKey: string;
  taskId: string;
}): Promise<PlannerEffectivePatchV2 | null> {
  if (!params.sessionKey || !params.taskId) {
    return null;
  }
  const target = buildPlannerEffectivePatchV2Path(params.paths, params.sessionKey);
  if (!(await params.io.fileExists(target))) {
    return null;
  }
  const now = new Date().toISOString();
  const fallback: PlannerEffectivePatchV2 = {
    schema_version: "planner-effective-patch-v2",
    session_key: params.sessionKey,
    task_id: params.taskId,
    compiled_at: now,
    compiled_from_versions: {
      from_version: 0,
      to_version: 0,
    },
    effective_patch: {
      task_goal_patch: null,
      constraints_patch: [],
      deliverables_patch: [],
      notes_patch: [],
      workspace_patch: null,
      budget_patch: null,
    },
    source_versions: {
      goal: [],
      constraints: [],
      deliverables: [],
      notes: [],
      workspace: [],
      budget: [],
    },
    dedupe_basis: {
      goal: "last_write_wins",
      constraints: "set_union_minus_remove",
      deliverables: "set_union_minus_remove",
      notes: "dedupe_append",
      workspace: "last_valid_set",
      budget: "last_valid_set",
    },
    conflicts: [],
  };
  const raw = await params.io.readJsonOrDefault<Record<string, unknown>>(target, fallback);
  return normalizeEffectivePatchV2(raw, fallback);
}

export async function writePlannerAmendmentWatermarkV2Store(params: {
  io: OrchestrateStateIo;
  paths: ReceptionistStatePaths;
  watermark: PlannerAmendmentWatermarkV2;
}): Promise<void> {
  await params.io.writeJsonAtomic(
    buildPlannerAmendmentWatermarkV2Path(params.paths, params.watermark.session_key),
    params.watermark,
  );
}

export async function readPlannerAmendmentWatermarkV2Store(params: {
  io: OrchestrateStateIo;
  paths: ReceptionistStatePaths;
  sessionKey: string;
  taskId: string;
}): Promise<PlannerAmendmentWatermarkV2 | null> {
  if (!params.sessionKey || !params.taskId) {
    return null;
  }
  const target = buildPlannerAmendmentWatermarkV2Path(params.paths, params.sessionKey);
  if (!(await params.io.fileExists(target))) {
    return null;
  }
  const now = new Date().toISOString();
  const fallback: PlannerAmendmentWatermarkV2 = {
    schema_version: "planner-amendment-watermark-v2",
    session_key: params.sessionKey,
    task_id: params.taskId,
    head_version: 0,
    applying_version: 0,
    consumed_version: 0,
    last_release_reason: null,
    updated_at: now,
  };
  const raw = await params.io.readJsonOrDefault<Record<string, unknown>>(target, fallback);
  return normalizeWatermarkV2(raw, fallback);
}
