import { handlePathSubcommand } from "../orchestrate-path-command.js";
import { buildEmptyPathState, type PathState } from "../orchestrate-path.js";
import { describe, expect, it } from "vitest";

describe("orchestrate-path command handler", () => {
  it("sets, gets, lists, and clears project defaults", async () => {
    let state: PathState = buildEmptyPathState("2026-03-02T00:00:00.000Z");

    const readPathState = async () => state;
    const writePathState = async (next: PathState) => {
      state = next;
    };

    const setText = await handlePathSubcommand({
      payload: "set --project-id demo --workspace-root demo/runs/custom",
      senderId: "tester",
      repoRoot: "/repo",
      projectsRoot: "projects",
      readPathState,
      writePathState,
      now: () => "2026-03-02T00:00:01.000Z",
    });
    expect(setText).toContain("status: set");
    expect(state.projects.demo?.workspace_root).toBe("demo/runs/custom");

    const getText = await handlePathSubcommand({
      payload: "get --project-id demo",
      repoRoot: "/repo",
      projectsRoot: "projects",
      readPathState,
      writePathState,
    });
    expect(getText).toContain("workspace_root: demo/runs/custom");

    const listText = await handlePathSubcommand({
      payload: "list",
      repoRoot: "/repo",
      projectsRoot: "projects",
      readPathState,
      writePathState,
    });
    expect(listText).toContain("projects:");
    expect(listText).toContain("- demo workspace_root=demo/runs/custom");

    const clearText = await handlePathSubcommand({
      payload: "clear --project-id demo",
      repoRoot: "/repo",
      projectsRoot: "projects",
      readPathState,
      writePathState,
      now: () => "2026-03-02T00:00:02.000Z",
    });
    expect(clearText).toContain("workspace_root: (cleared)");
    expect(state.projects.demo).toBeUndefined();
  });

  it("rejects invalid input", async () => {
    const readPathState = async () => buildEmptyPathState();
    const writePathState = async () => undefined;

    await expect(
      handlePathSubcommand({
        payload: "set --project-id bad/../id --workspace-root demo/runs/custom",
        repoRoot: "/repo",
        projectsRoot: "projects",
        readPathState,
        writePathState,
      }),
    ).resolves.toBe("path command requires valid --project-id");

    await expect(
      handlePathSubcommand({
        payload: "set --project-id demo --workspace-root ../escape",
        repoRoot: "/repo",
        projectsRoot: "projects",
        readPathState,
        writePathState,
      }),
    ).resolves.toContain("invalid --workspace-root:");
  });
});
