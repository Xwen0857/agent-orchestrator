import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PlannerDependencySemantics = {
  dependency_mode: "component_semantic_linearized";
  summary_note: string;
  component_dependency_map: Record<string, string>;
};

export type PlannerDependencyDefaults = {
  dependency_mode: "component_semantic_linearized";
  summary_note: string;
  fallback_dependency_summary: {
    roots: number;
    blocked: number;
    links: number;
    cross_module_links: number;
  };
};

export type PlannerDependencyConfig = {
  semantics: PlannerDependencySemantics;
  defaults: PlannerDependencyDefaults;
};

let dependencySemanticsCache: PlannerDependencySemantics | null = null;
let dependencyDefaultsCache: PlannerDependencyDefaults | null = null;

const BUILTIN_DEPENDENCY_DEFAULTS: PlannerDependencyDefaults = {
  dependency_mode: "component_semantic_linearized",
  summary_note: "planning_hint_not_scheduler_dag",
  fallback_dependency_summary: {
    roots: 0,
    blocked: 0,
    links: 0,
    cross_module_links: 0,
  },
};

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(0, Math.floor(n));
}

export function loadDependencyDefaults(): PlannerDependencyDefaults {
  if (dependencyDefaultsCache) {
    return dependencyDefaultsCache;
  }
  try {
    const sourcePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "templates",
      "coordination",
      "orchestrator",
      "planner_dependency_defaults.json",
    );
    const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as Record<string, unknown>;
    const fallbackSummary =
      parsed.fallback_dependency_summary &&
      typeof parsed.fallback_dependency_summary === "object" &&
      !Array.isArray(parsed.fallback_dependency_summary)
        ? (parsed.fallback_dependency_summary as Record<string, unknown>)
        : {};
    dependencyDefaultsCache = {
      dependency_mode:
        parsed.dependency_mode === "component_semantic_linearized"
          ? "component_semantic_linearized"
          : BUILTIN_DEPENDENCY_DEFAULTS.dependency_mode,
      summary_note:
        typeof parsed.summary_note === "string" && parsed.summary_note.trim()
          ? parsed.summary_note.trim()
          : BUILTIN_DEPENDENCY_DEFAULTS.summary_note,
      fallback_dependency_summary: {
        roots: normalizeNonNegativeInt(
          fallbackSummary.roots,
          BUILTIN_DEPENDENCY_DEFAULTS.fallback_dependency_summary.roots,
        ),
        blocked: normalizeNonNegativeInt(
          fallbackSummary.blocked,
          BUILTIN_DEPENDENCY_DEFAULTS.fallback_dependency_summary.blocked,
        ),
        links: normalizeNonNegativeInt(
          fallbackSummary.links,
          BUILTIN_DEPENDENCY_DEFAULTS.fallback_dependency_summary.links,
        ),
        cross_module_links: normalizeNonNegativeInt(
          fallbackSummary.cross_module_links,
          BUILTIN_DEPENDENCY_DEFAULTS.fallback_dependency_summary.cross_module_links,
        ),
      },
    };
  } catch {
    dependencyDefaultsCache = BUILTIN_DEPENDENCY_DEFAULTS;
  }
  return dependencyDefaultsCache;
}

export function loadDependencySemantics(): PlannerDependencySemantics {
  if (dependencySemanticsCache) {
    return dependencySemanticsCache;
  }
  const dependencyDefaults = loadDependencyDefaults();
  const defaults: PlannerDependencySemantics = {
    dependency_mode: dependencyDefaults.dependency_mode,
    summary_note: dependencyDefaults.summary_note,
    component_dependency_map: {},
  };
  try {
    const sourcePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "templates",
      "coordination",
      "orchestrator",
      "planner_dependency_semantics.json",
    );
    const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as Record<string, unknown>;
    dependencySemanticsCache = {
      dependency_mode:
        parsed.dependency_mode === "component_semantic_linearized"
          ? "component_semantic_linearized"
          : defaults.dependency_mode,
      summary_note:
        typeof parsed.summary_note === "string" && parsed.summary_note.trim()
          ? parsed.summary_note
          : defaults.summary_note,
      component_dependency_map:
        parsed.component_dependency_map &&
        typeof parsed.component_dependency_map === "object" &&
        !Array.isArray(parsed.component_dependency_map)
          ? Object.fromEntries(
              Object.entries(parsed.component_dependency_map as Record<string, unknown>)
                .filter(([key, value]) => typeof key === "string" && typeof value === "string")
                .map(([key, value]) => [key.trim(), String(value).trim()]),
            )
          : defaults.component_dependency_map,
    };
  } catch {
    dependencySemanticsCache = defaults;
  }
  return dependencySemanticsCache;
}

export function loadPlannerDependencyConfig(): PlannerDependencyConfig {
  return {
    semantics: loadDependencySemantics(),
    defaults: loadDependencyDefaults(),
  };
}
