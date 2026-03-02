import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OrchestrateIo = {
  fileExists: (filePath: string) => Promise<boolean>;
  readJsonOrDefault: <T>(filePath: string, fallback: T) => Promise<T>;
  readText: (filePath: string) => Promise<string>;
  writeTextAtomic: (filePath: string, content: string) => Promise<void>;
  writeJsonAtomic: (filePath: string, value: unknown) => Promise<void>;
  readNdjson: (filePath: string) => Promise<Array<Record<string, unknown>>>;
  appendNdjson: (filePath: string, row: Record<string, unknown>) => Promise<void>;
  runScript: (
    scriptPath: string,
    args: string[],
    cwd: string,
  ) => Promise<{ stdout: string; stderr: string }>;
};

export function resolvePath(root: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(root, filePath);
}

export function resolveExistingPath(candidates: string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0] ?? "";
}

export function resolvePluginStateDir(api: OpenClawPluginApi): string {
  const runtimeDir = api.runtime.state.resolveStateDir();
  if (runtimeDir && runtimeDir !== "/.openclaw" && runtimeDir !== "/") {
    return runtimeDir;
  }
  const envDir =
    process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim() || "";
  if (envDir) {
    return envDir;
  }
  const home = process.env.HOME?.trim() || os.homedir();
  return path.join(home, ".openclaw");
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonOrDefault<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

export function trimOutput(output: string, maxChars = 600): string {
  if (output.length <= maxChars) {
    return output;
  }
  return `${output.slice(0, maxChars)}...`;
}

export async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readNdjson(filePath: string): Promise<Array<Record<string, unknown>>> {
  if (!(await fileExists(filePath))) {
    return [];
  }
  const raw = await readText(filePath);
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export async function appendNdjson(filePath: string, row: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

export async function runScript(
  scriptPath: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(scriptPath, args, {
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export function createDefaultOrchestrateIo(): OrchestrateIo {
  return {
    fileExists,
    readJsonOrDefault,
    readText,
    writeTextAtomic,
    writeJsonAtomic,
    readNdjson,
    appendNdjson,
    runScript,
  };
}
