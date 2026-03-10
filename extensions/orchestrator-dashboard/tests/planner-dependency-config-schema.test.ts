import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readConfig(relativePath: string): Record<string, unknown> {
  const absolute = path.resolve(import.meta.dirname, "..", "..", "..", relativePath);
  return JSON.parse(readFileSync(absolute, "utf8")) as Record<string, unknown>;
}

describe("planner dependency config schema", () => {
  it("validates dependency semantics config shape", () => {
    const semantics = readConfig(
      "templates/coordination/orchestrator/planner_dependency_semantics.json",
    );
    expect(semantics.dependency_mode).toBe("component_semantic_linearized");
    const dependencyMap =
      semantics.component_dependency_map &&
      typeof semantics.component_dependency_map === "object" &&
      !Array.isArray(semantics.component_dependency_map)
        ? (semantics.component_dependency_map as Record<string, unknown>)
        : undefined;
    expect(dependencyMap).toBeDefined();
    for (const [key, value] of Object.entries(dependencyMap ?? {})) {
      expect(key.trim().length).toBeGreaterThan(0);
      expect(typeof value).toBe("string");
      expect(String(value).trim().length).toBeGreaterThan(0);
    }
  });

  it("validates dependency defaults config shape and alignment", () => {
    const semantics = readConfig(
      "templates/coordination/orchestrator/planner_dependency_semantics.json",
    );
    const defaults = readConfig(
      "templates/coordination/orchestrator/planner_dependency_defaults.json",
    );
    expect(defaults.dependency_mode).toBe("component_semantic_linearized");
    expect(defaults.dependency_mode).toBe(semantics.dependency_mode);
    expect(typeof defaults.summary_note).toBe("string");
    expect(String(defaults.summary_note).trim().length).toBeGreaterThan(0);

    const summary =
      defaults.fallback_dependency_summary &&
      typeof defaults.fallback_dependency_summary === "object" &&
      !Array.isArray(defaults.fallback_dependency_summary)
        ? (defaults.fallback_dependency_summary as Record<string, unknown>)
        : undefined;
    expect(summary).toBeDefined();
    for (const key of ["roots", "blocked", "links", "cross_module_links"]) {
      const value = Number(summary?.[key]);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
