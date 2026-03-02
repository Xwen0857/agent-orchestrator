import { describe, expect, it } from "vitest";
import { resolveExistingPath, resolvePath, trimOutput } from "../orchestrate-io.js";

describe("orchestrate-io", () => {
  it("resolves relative paths under the repo root", () => {
    expect(resolvePath("/repo", "configs/current.json")).toBe("/repo/configs/current.json");
    expect(resolvePath("/repo", "/abs/current.json")).toBe("/abs/current.json");
  });

  it("falls back to the first candidate when no file exists", () => {
    expect(resolveExistingPath(["/nope/a", "/nope/b"])).toBe("/nope/a");
  });

  it("trims oversized output", () => {
    expect(trimOutput("abcdef", 4)).toBe("abcd...");
  });
});
