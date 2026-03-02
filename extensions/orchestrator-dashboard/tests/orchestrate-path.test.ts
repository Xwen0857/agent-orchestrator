import {
  buildEmptyPathState,
  isSafeProjectId,
  normalizePathState,
  parseKvFlags,
  resolveWorkspaceConfigForRun,
  resolveWorkspaceUnderProjects,
  validateWorkspaceRootRelative,
} from "../orchestrate-path.js";
import { describe, expect, it } from "vitest";

describe("orchestrate-path pure logic", () => {
  it("parses kv flags and preserves positionals", () => {
    expect(parseKvFlags("set --project-id demo --workspace-root apps/demo extra")).toEqual({
      flags: {
        "project-id": "demo",
        "workspace-root": "apps/demo",
      },
      positionals: ["set", "extra"],
    });
  });

  it("validates project ids and workspace roots", () => {
    expect(isSafeProjectId("prj.demo_1")).toBe(true);
    expect(isSafeProjectId("../bad")).toBe(false);

    expect(validateWorkspaceRootRelative("apps/demo")).toBeNull();
    expect(validateWorkspaceRootRelative("")).toBe("workspace_root is required");
    expect(validateWorkspaceRootRelative("/tmp/demo")).toBe("workspace_root must be relative");
    expect(validateWorkspaceRootRelative("../demo")).toBe(
      "workspace_root cannot escape projects root",
    );
  });

  it("normalizes path state and filters invalid project ids", () => {
    const normalized = normalizePathState({
      updated_at: "2026-03-02T00:00:00.000Z",
      projects: {
        valid_id: {
          workspace_root: "apps/demo",
          updated_at: "2026-03-02T00:00:01.000Z",
          updated_by: "tester",
        },
        "../bad": {
          workspace_root: "apps/bad",
        },
        missing_root: {
          updated_by: "nobody",
        },
      },
    });

    expect(normalized.schema_version).toBe("orchestrate-path-state-v1");
    expect(Object.keys(normalized.projects)).toEqual(["valid_id"]);
    expect(normalized.projects.valid_id?.workspace_root).toBe("apps/demo");
  });

  it("resolves workspace under projects root and rejects escape", () => {
    expect(
      resolveWorkspaceUnderProjects({
        repoRoot: "/repo",
        projectsRootRel: "projects",
        workspaceRootRel: "demo/runs/x/workspace",
      }),
    ).toBe("/repo/projects/demo/runs/x/workspace");

    expect(() =>
      resolveWorkspaceUnderProjects({
        repoRoot: "/repo",
        projectsRootRel: "projects",
        workspaceRootRel: "../escape",
      }),
    ).toThrow("workspace_root escapes projects root");
  });

  it("resolves run workspace config by flag, then path default, then runtime default", () => {
    const state = buildEmptyPathState("2026-03-02T00:00:00.000Z");
    state.projects.demo = {
      workspace_root: "demo/runs/custom",
      updated_at: "2026-03-02T00:00:01.000Z",
      updated_by: "tester",
    };

    expect(
      resolveWorkspaceConfigForRun({
        repoRoot: "/repo",
        projectsRootRel: "projects",
        pathState: state,
        projectIdFromFlag: "demo",
        workspaceRootFromFlag: "demo/runs/flag",
        taskId: "task_1",
      }),
    ).toMatchObject({
      projectId: "demo",
      workspaceRoot: "demo/runs/flag",
      source: "run_flag",
      validated: true,
    });

    expect(
      resolveWorkspaceConfigForRun({
        repoRoot: "/repo",
        projectsRootRel: "projects",
        pathState: state,
        projectIdFromFlag: "demo",
        workspaceRootFromFlag: "",
        taskId: "task_1",
      }),
    ).toMatchObject({
      projectId: "demo",
      workspaceRoot: "demo/runs/custom",
      source: "path_default",
      validated: true,
    });

    expect(
      resolveWorkspaceConfigForRun({
        repoRoot: "/repo",
        projectsRootRel: "projects",
        pathState: buildEmptyPathState(),
        projectIdFromFlag: "",
        workspaceRootFromFlag: "",
        taskId: "task_99",
      }),
    ).toMatchObject({
      projectId: "prj_default",
      workspaceRoot: "prj_default/runs/task_99/workspace",
      source: "runtime_default",
      validated: true,
    });
  });

  it("rejects invalid run path combinations", () => {
    expect(() =>
      resolveWorkspaceConfigForRun({
        repoRoot: "/repo",
        projectsRootRel: "projects",
        pathState: buildEmptyPathState(),
        projectIdFromFlag: "",
        workspaceRootFromFlag: "demo/runs/flag",
        taskId: "task_1",
      }),
    ).toThrow("run with --workspace-root requires --project-id");

    expect(() =>
      resolveWorkspaceConfigForRun({
        repoRoot: "/repo",
        projectsRootRel: "projects",
        pathState: buildEmptyPathState(),
        projectIdFromFlag: "bad/../id",
        workspaceRootFromFlag: "",
        taskId: "task_1",
      }),
    ).toThrow("invalid --project-id");
  });
});
