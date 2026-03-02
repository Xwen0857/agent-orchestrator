import { promises as fs } from "node:fs";
import path from "node:path";

const KV_RE = /^([A-Za-z0-9_\-.]+)\s*:\s*(.*)$/u;
const LIST_KV_RE = /^-\s*([A-Za-z0-9_\-.]+)\s*:\s*(.*)$/u;

export type ValidationIssue = {
  source: "plannerCurrent" | "plannerProperties" | "auditPolicy";
  key: string;
  level: "ERROR" | "WARN";
  message: string;
};

function coerce(value: string): unknown {
  const v = value.trim();
  if (v === "") {
    return null;
  }
  if (v === "true") {
    return true;
  }
  if (v === "false") {
    return false;
  }
  const asNum = Number(v);
  if (!Number.isNaN(asNum) && /^-?\d+(\.\d+)?$/.test(v)) {
    return asNum;
  }
  return v;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function parsePlainKv(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(KV_RE);
    if (!match) {
      continue;
    }
    out[match[1] ?? ""] = coerce(match[2] ?? "");
  }
  return out;
}

export function parseListKv(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line) {
      continue;
    }
    const match = line.match(LIST_KV_RE);
    if (!match) {
      continue;
    }
    out[match[1] ?? ""] = coerce(match[2] ?? "");
  }
  return out;
}

export function updatePlainKvText(original: string, values: Record<string, unknown>): string {
  const remaining = new Map<string, string>();
  for (const [key, value] of Object.entries(values)) {
    remaining.set(key, stringifyValue(value));
  }

  const out: string[] = [];
  for (const lineRaw of original.split(/\r?\n/)) {
    const trimmed = lineRaw.trim();
    const match = trimmed.match(KV_RE);
    if (match) {
      const key = match[1] ?? "";
      if (remaining.has(key)) {
        out.push(`${key}: ${remaining.get(key) ?? ""}`);
        remaining.delete(key);
        continue;
      }
    }
    out.push(lineRaw);
  }

  if (remaining.size > 0) {
    if (out.length > 0 && out[out.length - 1]?.trim() !== "") {
      out.push("");
    }
    for (const [key, value] of [...remaining.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`${key}: ${value}`);
    }
  }

  return `${out.join("\n").replace(/\n+$/u, "")}\n`;
}

export function updateListKvText(original: string, values: Record<string, unknown>): string {
  const remaining = new Map<string, string>();
  for (const [key, value] of Object.entries(values)) {
    remaining.set(key, stringifyValue(value));
  }

  const out: string[] = [];
  for (const lineRaw of original.split(/\r?\n/)) {
    const trimmed = lineRaw.trim();
    const match = trimmed.match(LIST_KV_RE);
    if (match) {
      const key = match[1] ?? "";
      if (remaining.has(key)) {
        out.push(`- ${key}: ${remaining.get(key) ?? ""}`);
        remaining.delete(key);
        continue;
      }
    }
    out.push(lineRaw);
  }

  if (remaining.size > 0) {
    if (out.length > 0 && out[out.length - 1]?.trim() !== "") {
      out.push("");
    }
    for (const [key, value] of [...remaining.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`- ${key}: ${value}`);
    }
  }

  return `${out.join("\n").replace(/\n+$/u, "")}\n`;
}

export function inferRisk(
  before: Record<string, unknown>,
  next: Record<string, unknown>,
  policyBefore: Record<string, unknown>,
  policyNext: Record<string, unknown>,
  propsBefore: Record<string, unknown>,
  propsNext: Record<string, unknown>,
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  const highKeys = [
    "transition_script",
    "audit_gate_script",
    "approval_grant_script",
    "config_rollback_script",
  ];
  if (highKeys.some((key) => before[key] !== next[key])) {
    return "HIGH";
  }

  const beforeRules = Array.isArray(policyBefore.rules) ? policyBefore.rules : [];
  const nextRules = Array.isArray(policyNext.rules) ? policyNext.rules : [];
  if (JSON.stringify(beforeRules) !== JSON.stringify(nextRules)) {
    const disabledCritical = nextRules.some((rule) => {
      if (!rule || typeof rule !== "object") {
        return false;
      }
      const record = rule as Record<string, unknown>;
      return record.tier === "CRITICAL" && record.enabled === false;
    });
    return disabledCritical ? "CRITICAL" : "HIGH";
  }

  if (JSON.stringify(propsBefore) !== JSON.stringify(propsNext)) {
    return "MEDIUM";
  }

  return "LOW";
}

export function createConfigService(params: {
  paths: {
    plannerCurrent: string;
    plannerProperties: string;
    auditPolicy: string;
  };
  lockPath: string;
  io: {
    readText: (targetPath: string) => Promise<string>;
    readJsonOrDefault: <T>(targetPath: string, fallback: T) => Promise<T>;
  };
}) {
  const loadCurrentConfig = async () => {
    const [currentRaw, propsRaw, policy] = await Promise.all([
      params.io.readText(params.paths.plannerCurrent),
      params.io.readText(params.paths.plannerProperties),
      params.io.readJsonOrDefault<Record<string, unknown>>(params.paths.auditPolicy, {}),
    ]);
    return {
      plannerCurrent: parsePlainKv(currentRaw),
      plannerProperties: parseListKv(propsRaw),
      auditPolicy: policy,
    };
  };

  const validateDraft = async (draftInput: unknown) => {
    const draft =
      draftInput && typeof draftInput === "object" && !Array.isArray(draftInput)
        ? (draftInput as Record<string, unknown>)
        : {};

    const plannerCurrent =
      draft.plannerCurrent && typeof draft.plannerCurrent === "object" && !Array.isArray(draft.plannerCurrent)
        ? (draft.plannerCurrent as Record<string, unknown>)
        : {};
    const plannerProperties =
      draft.plannerProperties &&
      typeof draft.plannerProperties === "object" &&
      !Array.isArray(draft.plannerProperties)
        ? (draft.plannerProperties as Record<string, unknown>)
        : {};
    const auditPolicy =
      draft.auditPolicy && typeof draft.auditPolicy === "object" && !Array.isArray(draft.auditPolicy)
        ? (draft.auditPolicy as Record<string, unknown>)
        : {};

    const base = await loadCurrentConfig();

    const issues: ValidationIssue[] = [];
    for (const key of ["version", "state_machine", "transition_script", "audit_gate_script"]) {
      const value = plannerCurrent[key];
      if (value === undefined || value === null || String(value).trim() === "") {
        issues.push({
          source: "plannerCurrent",
          key,
          level: "ERROR",
          message: "required key missing",
        });
      }
    }

    for (const key of [
      "worker_timeout_minutes",
      "pass_rate_window_size",
      "pass_rate_replace_threshold",
      "budget_warn_threshold_ratio",
      "budget_block_threshold_ratio",
      "dashboard_refresh_minutes",
      "health_check_interval_minutes",
      "stale_in_progress_minutes",
      "keeper_cycle_minutes",
    ]) {
      const value = plannerProperties[key];
      if (value === undefined || value === null || String(value).trim() === "") {
        continue;
      }
      if (Number.isNaN(Number(value))) {
        issues.push({
          source: "plannerProperties",
          key,
          level: "ERROR",
          message: "must be numeric",
        });
      }
    }

    if (!Array.isArray(auditPolicy.rules)) {
      issues.push({
        source: "auditPolicy",
        key: "rules",
        level: "ERROR",
        message: "rules must be a list",
      });
    }

    const changedKeys = {
      plannerCurrent: Object.keys({ ...base.plannerCurrent, ...plannerCurrent }).filter(
        (key) => base.plannerCurrent[key] !== plannerCurrent[key],
      ),
      plannerProperties: Object.keys({ ...base.plannerProperties, ...plannerProperties }).filter(
        (key) => base.plannerProperties[key] !== plannerProperties[key],
      ),
      auditPolicy:
        JSON.stringify(base.auditPolicy) === JSON.stringify(auditPolicy) ? [] : ["rules", "version"],
    };

    const riskLevel = inferRisk(
      base.plannerCurrent,
      plannerCurrent,
      base.auditPolicy,
      auditPolicy,
      base.plannerProperties,
      plannerProperties,
    );
    const valid = !issues.some((issue) => issue.level === "ERROR");

    return {
      valid,
      requiresApproval: riskLevel === "HIGH" || riskLevel === "CRITICAL",
      riskLevel,
      issues,
      changedKeys,
    };
  };

  const acquireLock = async (): Promise<boolean> => {
    await fs.mkdir(path.dirname(params.lockPath), { recursive: true });
    try {
      const handle = await fs.open(params.lockPath, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      return true;
    } catch {
      return false;
    }
  };

  const releaseLock = async (): Promise<void> => {
    try {
      await fs.unlink(params.lockPath);
    } catch {
      // ignore
    }
  };

  return {
    loadCurrentConfig,
    validateDraft,
    acquireLock,
    releaseLock,
  };
}
