import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildOperationId,
  buildStrategyFromSummary,
  buildTaskId,
  normalizeFreeTextToStrategy,
  runWhitelistedScript,
} from "./orchestrate-command.js";
import {
  applyMessageToDraft,
  appendSessionHistory,
  buildEntryAgentContext,
  buildEmptyOrchestrateSession,
  buildSessionFilePath,
  buildSummaryFromDraft,
  buildSummaryFilePath,
  extractLatestUserMessage,
  getRunnableSummary,
  normalizeOrchestrateSession,
  parseOrchestrateArgs,
  renderSessionSummary,
  resolveConversationSessionKey,
  validateRunCommandPayload,
  type OrchestrateSessionState,
} from "./orchestrate-session.js";

const execFileAsync = promisify(execFile);

type DashboardPluginConfig = {
  enabled: boolean;
  repoRoot: string;
  basePath: string;
  apiBasePath: string;
  dashboardJsonPath: string;
  systemHealthJsonPath: string;
  plannerCurrentPath: string;
  plannerPropertiesPath: string;
  auditPolicyPath: string;
  configHistoryPath: string;
  snapshotScriptPath: string;
  rollbackScriptPath: string;
  requireGatewayAuth: boolean;
  runnerEnabled: boolean;
  runnerIntervalSec: number;
  runnerExecutionMode: "local_threads" | "container" | "distributed";
  runnerBatchSize: number;
  runnerMaxParallel: number;
  runtimeConsistencyMode: "enforce" | "warn";
  runnerFallbackEnabled: boolean;
  runnerFallbackMode: "external_daemon" | "none";
  agentRuntimeConfigPath: string;
};

type AgentRuntimeConfig = {
  llm: {
    enabled: boolean;
    authMode: "auto" | "standalone" | "openclaw";
    apiBaseUrl: string;
    apiKey: string;
    apiKeyEnv: string;
    apiKeySource: string;
    model: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    systemPrompt: string;
  };
};

type ValidationIssue = {
  source: "plannerCurrent" | "plannerProperties" | "auditPolicy" | "runtime";
  key: string;
  level: "ERROR" | "WARN";
  message: string;
};

const DEFAULT_REPO_ROOT = process.env.OPENCLAW_ORCHESTRATOR_REPO_ROOT?.trim() || process.cwd();
const DEFAULT_BASE_PATH = "/plugins/orchestrator";
const DEFAULT_API_BASE_PATH = "/api/plugins/orchestrator";
const DEFAULT_REQUESTS_PATH = "templates/coordination/orchestrator/requests";
const DEFAULT_TASKS_ROOT = "templates/coordination/tasks/task_folders";
const DEFAULT_RUNNER_INTERVAL_SEC = 10;
const RUNNER_DEGRADED_THRESHOLD = 3;
const DEFAULT_AGENT_RUNTIME_CONFIG_PATH = "templates/coordination/orchestrator/agent_runtime.json";
const RUNTIME_MISMATCH_CODE = "ORCHESTRATOR_RUNTIME_MISMATCH";

const configSchema = {
  safeParse(value: unknown) {
    const normalized = parsePluginConfig(value);
    return { success: true as const, data: normalized };
  },
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: true },
      repoRoot: { type: "string" },
      basePath: { type: "string", default: DEFAULT_BASE_PATH },
      apiBasePath: { type: "string", default: DEFAULT_API_BASE_PATH },
      dashboardJsonPath: { type: "string" },
      systemHealthJsonPath: { type: "string" },
      plannerCurrentPath: { type: "string" },
      plannerPropertiesPath: { type: "string" },
      auditPolicyPath: { type: "string" },
      configHistoryPath: { type: "string" },
      snapshotScriptPath: { type: "string" },
      rollbackScriptPath: { type: "string" },
      requireGatewayAuth: { type: "boolean", default: true },
      runnerEnabled: { type: "boolean", default: true },
      runnerIntervalSec: { type: "number", default: DEFAULT_RUNNER_INTERVAL_SEC },
      runnerExecutionMode: { type: "string", default: "local_threads" },
      runnerBatchSize: { type: "number", default: 4 },
      runnerMaxParallel: { type: "number", default: 2 },
      runtimeConsistencyMode: { type: "string", default: "enforce" },
      runnerFallbackEnabled: { type: "boolean", default: true },
      runnerFallbackMode: { type: "string", default: "external_daemon" },
      agentRuntimeConfigPath: { type: "string", default: DEFAULT_AGENT_RUNTIME_CONFIG_PATH },
    },
  },
};

const KV_RE = /^([A-Za-z0-9_./-]+):\s*(.*)$/;
const LIST_KV_RE = /^-\s+([A-Za-z0-9_./-]+):\s*(.*)$/;

function parsePluginConfig(value: unknown): DashboardPluginConfig {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const repoRoot = asString(raw.repoRoot, DEFAULT_REPO_ROOT);
  const basePath = ensureLeadingSlash(asString(raw.basePath, DEFAULT_BASE_PATH));
  const apiBasePath = ensureLeadingSlash(asString(raw.apiBasePath, DEFAULT_API_BASE_PATH));

  return {
    enabled: asBoolean(raw.enabled, true),
    repoRoot,
    basePath,
    apiBasePath,
    dashboardJsonPath: asString(
      raw.dashboardJsonPath,
      "templates/coordination/orchestrator/dashboard.json",
    ),
    systemHealthJsonPath: asString(
      raw.systemHealthJsonPath,
      "templates/coordination/orchestrator/system-health.json",
    ),
    plannerCurrentPath: asString(
      raw.plannerCurrentPath,
      "templates/coordination/planner/config/current.md",
    ),
    plannerPropertiesPath: asString(
      raw.plannerPropertiesPath,
      "templates/coordination/planner/properties.md",
    ),
    auditPolicyPath: asString(
      raw.auditPolicyPath,
      "templates/coordination/audit/policy/current.json",
    ),
    configHistoryPath: asString(
      raw.configHistoryPath,
      "templates/coordination/planner/config/history/versions.ndjson",
    ),
    snapshotScriptPath: asString(
      raw.snapshotScriptPath,
      "agent-orchestrator/scripts/config_snapshot.sh",
    ),
    rollbackScriptPath: asString(
      raw.rollbackScriptPath,
      "agent-orchestrator/scripts/config_rollback.sh",
    ),
    requireGatewayAuth: asBoolean(raw.requireGatewayAuth, true),
    runnerEnabled: asBoolean(raw.runnerEnabled, true),
    runnerIntervalSec: asPositiveInt(raw.runnerIntervalSec, DEFAULT_RUNNER_INTERVAL_SEC),
    runnerExecutionMode: asExecutionMode(raw.runnerExecutionMode, "local_threads"),
    runnerBatchSize: asPositiveInt(raw.runnerBatchSize, 4),
    runnerMaxParallel: asPositiveInt(raw.runnerMaxParallel, 2),
    runtimeConsistencyMode: asConsistencyMode(raw.runtimeConsistencyMode, "enforce"),
    runnerFallbackEnabled: asBoolean(raw.runnerFallbackEnabled, true),
    runnerFallbackMode: asRunnerFallbackMode(raw.runnerFallbackMode, "external_daemon"),
    agentRuntimeConfigPath: asString(raw.agentRuntimeConfigPath, DEFAULT_AGENT_RUNTIME_CONFIG_PATH),
  };
}

function asString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
}

function asExecutionMode(
  value: unknown,
  fallback: "local_threads" | "container" | "distributed",
): "local_threads" | "container" | "distributed" {
  const normalized = asString(value, fallback).toLowerCase();
  if (
    normalized === "local_threads" ||
    normalized === "container" ||
    normalized === "distributed"
  ) {
    return normalized;
  }
  return fallback;
}

function asConsistencyMode(value: unknown, fallback: "enforce" | "warn"): "enforce" | "warn" {
  const normalized = asString(value, fallback).toLowerCase();
  if (normalized === "enforce" || normalized === "warn") {
    return normalized;
  }
  return fallback;
}

function asRunnerFallbackMode(
  value: unknown,
  fallback: "external_daemon" | "none",
): "external_daemon" | "none" {
  const normalized = asString(value, fallback).toLowerCase();
  if (normalized === "external_daemon" || normalized === "none") {
    return normalized;
  }
  return fallback;
}

function ensureLeadingSlash(input: string): string {
  if (!input) {
    return "/";
  }
  return input.startsWith("/") ? input : `/${input}`;
}

function normalizeResponseJson(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("```")) {
    const stripped = trimmed.replace(/^```[a-zA-Z]*\n?/u, "").replace(/\n?```$/u, "");
    return stripped.trim();
  }
  return trimmed;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function resolvePath(root: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(root, filePath);
}

function resolveExistingPath(candidates: string[]): string {
  for (const p of candidates) {
    if (existsSync(p)) {
      return p;
    }
  }
  return candidates[0] ?? "";
}

type RuntimeSignatureFileSpec = {
  id: string;
  candidates: string[];
};

function resolvePluginStateDir(api: OpenClawPluginApi): string {
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOrDefault<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

function trimOutput(output: string, maxChars = 600): string {
  if (output.length <= maxChars) {
    return output;
  }
  return `${output.slice(0, maxChars)}...`;
}

function buildRuntimeMismatchMessage(params: {
  expectedSignature: string;
  actualSignature: string;
  signaturePath: string;
}): string {
  return [
    `code: ${RUNTIME_MISMATCH_CODE}`,
    `message: runtime signature mismatch (expected=${params.expectedSignature}, actual=${params.actualSignature})`,
    `signature_file: ${params.signaturePath}`,
    "fix: cd extensions/orchestrator-dashboard && bash scripts/gen-runtime-signature.sh",
  ].join("\n");
}

type WorkspaceConfigSource = "run_flag" | "path_default" | "runtime_default";

type PathStateProjectEntry = {
  workspace_root: string;
  updated_at: string;
  updated_by: string;
};

type PathState = {
  schema_version: "orchestrate-path-state-v1";
  updated_at: string;
  projects: Record<string, PathStateProjectEntry>;
};

function parseKvFlags(payload: string): {
  flags: Record<string, string>;
  positionals: string[];
} {
  const tokens = payload.split(/\s+/).filter(Boolean);
  const flags: Record<string, string> = {};
  const positionals: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? "";
    if (token.startsWith("--")) {
      const key = token.slice(2).trim();
      const value = (tokens[i + 1] ?? "").trim();
      if (key && value) {
        flags[key] = value;
        i += 1;
        continue;
      }
    }
    positionals.push(token);
  }
  return { flags, positionals };
}

function isSafeProjectId(projectId: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(projectId);
}

function validateWorkspaceRootRelative(workspaceRoot: string): string | null {
  if (!workspaceRoot) {
    return "workspace_root is required";
  }
  if (path.isAbsolute(workspaceRoot)) {
    return "workspace_root must be relative";
  }
  const normalized = path.posix.normalize(workspaceRoot.replace(/\\/gu, "/"));
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized === "."
  ) {
    return "workspace_root cannot escape projects root";
  }
  return null;
}

function resolveWorkspaceUnderProjects(params: {
  repoRoot: string;
  projectsRootRel: string;
  workspaceRootRel: string;
}): string {
  const projectsRootAbs = path.resolve(params.repoRoot, params.projectsRootRel);
  const resolved = path.resolve(projectsRootAbs, params.workspaceRootRel);
  const withSep = projectsRootAbs.endsWith(path.sep)
    ? projectsRootAbs
    : `${projectsRootAbs}${path.sep}`;
  if (resolved !== projectsRootAbs && !resolved.startsWith(withSep)) {
    throw new Error("workspace_root escapes projects root");
  }
  return resolved;
}

function renderOrchestrateHelp(): string {
  return [
    "/orchestrate start",
    "/orchestrate summary",
    "/orchestrate run",
    "/orchestrate stop",
    "/orchestrate session",
    "/orchestrate intake <free text> (legacy helper)",
    "/orchestrate status <task_id>",
    "/orchestrate status",
    "/orchestrate path set --project-id <project_id> --workspace-root <relative_path_under_projects>",
    "/orchestrate path get --project-id <project_id>",
    "/orchestrate path clear --project-id <project_id>",
    "/orchestrate path list",
    "/orchestrate amend <task_id> <extra requirement>",
    "/orchestrate kb-sync <task_id> [approve|deny|auto-on|auto-off]",
    "/orchestrate help",
  ].join("\n");
}

function renderRequiredConfigChecklist(): string {
  return [
    "required_config:",
    "- planner_current: version, state_machine, transition_script, audit_gate_script",
    "- planner_properties: worker_timeout_minutes, stale_in_progress_minutes, dashboard_refresh_minutes",
    "- audit_policy: rules[]",
    "- worker_profile: task-scoped worker id enabled",
  ].join("\n");
}

function buildWorkerIdFromTaskId(taskId: string): string {
  const raw = taskId
    .replace(/^task_/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48);
  return `worker_${raw || "generic"}`;
}

async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parsePlainKv(text: string): Record<string, unknown> {
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

function parseListKv(text: string): Record<string, unknown> {
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

function updatePlainKvText(original: string, values: Record<string, unknown>): string {
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

function updateListKvText(original: string, values: Record<string, unknown>): string {
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

async function readNdjson(filePath: string): Promise<Array<Record<string, unknown>>> {
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

async function appendNdjson(filePath: string, row: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

function inferRisk(
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

async function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload)}\n`);
}

function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function getBearerToken(req: IncomingMessage): string | null {
  const auth = String(req.headers.authorization ?? "");
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = auth.slice(7).trim();
  return token || null;
}

function isAuthorized(
  req: IncomingMessage,
  api: OpenClawPluginApi,
  cfg: DashboardPluginConfig,
): boolean {
  if (!cfg.requireGatewayAuth) {
    return true;
  }

  const requestToken = getBearerToken(req);
  if (!requestToken) {
    return false;
  }

  const configured = [
    api.config.gateway?.auth?.token,
    api.config.gateway?.auth?.password,
    process.env.OPENCLAW_GATEWAY_TOKEN,
    process.env.CLAWDBOT_GATEWAY_TOKEN,
    process.env.OPENCLAW_GATEWAY_PASSWORD,
    process.env.CLAWDBOT_GATEWAY_PASSWORD,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length === 0) {
    return true;
  }
  return configured.includes(requestToken);
}

async function runScript(
  scriptPath: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const res = await execFileAsync(scriptPath, args, {
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return {
    stdout: res.stdout.trim(),
    stderr: res.stderr.trim(),
  };
}

function renderDashboardHtml(params: { apiBasePath: string; title: string }): string {
  const { apiBasePath, title } = params;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { --bg:#f2f5ee; --ink:#102313; --muted:#4b6351; --card:#fff; --line:#cddbcf; --accent:#1f7a4f; --warn:#8a3f1e; }
    body { margin:0; font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif; color:var(--ink); background: radial-gradient(circle at 20% 10%, #dfebdf, var(--bg)); }
    .top { position:sticky; top:0; background:rgba(255,255,255,0.9); border-bottom:1px solid var(--line); padding:12px 18px; display:flex; align-items:center; justify-content:space-between; }
    .top h1 { margin:0; font-size:18px; }
    .layout { padding:16px; display:grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap:14px; }
    .card { background:var(--card); border:1px solid var(--line); box-shadow:0 6px 12px rgba(0,0,0,0.06); padding:12px; }
    .card h2 { margin:0 0 8px; font-size:16px; }
    pre { margin:0; max-height:360px; overflow:auto; background:#f8fbf7; border:1px solid var(--line); padding:10px; }
    textarea { width:100%; min-height:320px; font-family: ui-monospace, SFMono-Regular, monospace; border:1px solid var(--line); }
    .row { display:flex; gap:8px; flex-wrap:wrap; }
    button { border:1px solid var(--accent); background:var(--accent); color:#fff; padding:8px 10px; cursor:pointer; }
    .banner { margin:12px 18px 0; padding:8px 10px; border:1px solid #f0cf92; background:#fff8ea; color:var(--warn); }
  </style>
</head>
<body>
  <header class="top">
    <h1>${title}</h1>
    <div class="row">
      <button id="btnRefresh">Refresh</button>
      <button id="btnValidate">Validate Draft</button>
      <button id="btnCommit">Commit Draft</button>
    </div>
  </header>
  <div id="msg" class="banner" style="display:none"></div>
  <main class="layout">
    <section class="card"><h2>Overview</h2><pre id="overview">loading...</pre></section>
    <section class="card"><h2>Events</h2><pre id="events">loading...</pre></section>
    <section class="card" style="grid-column:1/-1"><h2>Config Draft</h2><textarea id="draft"></textarea></section>
  </main>
  <script>
    const API_BASE = ${JSON.stringify(apiBasePath)};
    const msg = document.getElementById('msg');
    const overviewEl = document.getElementById('overview');
    const eventsEl = document.getElementById('events');
    const draftEl = document.getElementById('draft');

    function getAuthToken() {
      return localStorage.getItem('openclaw_gateway_token') || '';
    }

    async function request(path, init = {}) {
      const token = getAuthToken();
      const headers = { ...(init.headers || {}) };
      if (token) headers.Authorization = 'Bearer ' + token;
      if (!headers['Content-Type'] && init.body) headers['Content-Type'] = 'application/json';
      const res = await fetch(API_BASE + path, { ...init, headers });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || ('HTTP ' + res.status));
      }
      return res.json();
    }

    function showMsg(text) {
      msg.style.display = '';
      msg.textContent = text;
      setTimeout(() => { msg.style.display = 'none'; }, 4500);
    }

    async function refresh() {
      try {
        const [overview, cfg, events] = await Promise.all([
          request('/overview'),
          request('/configs/current'),
          request('/events?limit=100')
        ]);
        overviewEl.textContent = JSON.stringify(overview, null, 2);
        draftEl.value = JSON.stringify(cfg, null, 2);
        eventsEl.textContent = JSON.stringify(events, null, 2);
      } catch (err) {
        showMsg(String(err));
      }
    }

    document.getElementById('btnRefresh').addEventListener('click', refresh);
    document.getElementById('btnValidate').addEventListener('click', async () => {
      try {
        const draft = JSON.parse(draftEl.value || '{}');
        const res = await request('/configs/validate', {
          method: 'POST',
          body: JSON.stringify({ draft, reason: 'validate from plugin ui' })
        });
        showMsg('validate=' + res.valid + ', risk=' + res.riskLevel + ', approval=' + res.requiresApproval);
      } catch (err) {
        showMsg(String(err));
      }
    });
    document.getElementById('btnCommit').addEventListener('click', async () => {
      try {
        const draft = JSON.parse(draftEl.value || '{}');
        const res = await request('/configs/commit', {
          method: 'POST',
          body: JSON.stringify({ draft, reason: 'commit from plugin ui' })
        });
        showMsg('commit ok snapshot=' + res.snapshotVersion);
        await refresh();
      } catch (err) {
        showMsg(String(err));
      }
    });

    if (!getAuthToken()) {
      const token = prompt('Enter OpenClaw gateway token/password (optional if auth disabled):');
      if (token) localStorage.setItem('openclaw_gateway_token', token.trim());
    }
    refresh();
  </script>
</body>
</html>`;
}

const orchestratorDashboardPlugin = {
  id: "orchestrator-dashboard",
  name: "Orchestrator Dashboard",
  description: "Dashboard + Config Studio for orchestrator files",
  configSchema,
  register(api: OpenClawPluginApi) {
    const cfg = parsePluginConfig(api.pluginConfig);
    if (!cfg.enabled) {
      api.logger.info("orchestrator-dashboard: disabled by config");
      return;
    }

    const basePath = ensureLeadingSlash(cfg.basePath);
    const apiBasePath = ensureLeadingSlash(cfg.apiBasePath);
    const repoRoot = cfg.repoRoot;
    const pluginDir = path.dirname(fileURLToPath(import.meta.url));

    const dataDir = path.join(resolvePluginStateDir(api), "plugins", "orchestrator-dashboard");
    const eventsPath = path.join(dataDir, "events.ndjson");
    const lockPath = path.join(dataDir, ".commit.lock");

    const paths = {
      dashboardJson: resolvePath(repoRoot, cfg.dashboardJsonPath),
      systemHealthJson: resolvePath(repoRoot, cfg.systemHealthJsonPath),
      orchestrateRequestsDir: resolvePath(repoRoot, DEFAULT_REQUESTS_PATH),
      orchestrateSessionsDir: resolvePath(repoRoot, "templates/coordination/orchestrator/sessions"),
      pathState: resolvePath(
        repoRoot,
        "templates/coordination/orchestrator/requests/path_state.json",
      ),
      taskFoldersRoot: resolvePath(repoRoot, DEFAULT_TASKS_ROOT),
      plannerCurrent: resolvePath(repoRoot, cfg.plannerCurrentPath),
      plannerProperties: resolvePath(repoRoot, cfg.plannerPropertiesPath),
      auditPolicy: resolvePath(repoRoot, cfg.auditPolicyPath),
      history: resolvePath(repoRoot, cfg.configHistoryPath),
      snapshotScript: resolvePath(repoRoot, cfg.snapshotScriptPath),
      rollbackScript: resolvePath(repoRoot, cfg.rollbackScriptPath),
      agentRuntimeConfig: resolvePath(repoRoot, cfg.agentRuntimeConfigPath),
      executionRuntime: resolvePath(
        repoRoot,
        "templates/coordination/orchestrator/execution_runtime.json",
      ),
    };
    const runnerLockPath = resolvePath(
      repoRoot,
      "templates/coordination/orchestrator/.orchestrate-runner.lock",
    );
    const runtimeSignaturePath = resolveExistingPath([
      path.join(pluginDir, "runtime.signature.json"),
      resolvePath(repoRoot, "extensions/orchestrator-dashboard/runtime.signature.json"),
    ]);
    const runtimeSignatureFiles: RuntimeSignatureFileSpec[] = [
      {
        id: "extensions/orchestrator-dashboard/index.ts",
        candidates: [
          path.join(pluginDir, "index.ts"),
          path.join(pluginDir, "index.js"),
          resolvePath(repoRoot, "extensions/orchestrator-dashboard/index.ts"),
          resolvePath(repoRoot, "extensions/orchestrator-dashboard/index.js"),
        ],
      },
      {
        id: "extensions/orchestrator-dashboard/orchestrate-command.ts",
        candidates: [
          path.join(pluginDir, "orchestrate-command.ts"),
          path.join(pluginDir, "orchestrate-command.js"),
          resolvePath(
            repoRoot,
            "extensions/orchestrator-dashboard/orchestrate-command.ts",
          ),
          resolvePath(
            repoRoot,
            "extensions/orchestrator-dashboard/orchestrate-command.js",
          ),
        ],
      },
      {
        id: "extensions/orchestrator-dashboard/openclaw.plugin.json",
        candidates: [
          path.join(pluginDir, "openclaw.plugin.json"),
          resolvePath(repoRoot, "extensions/orchestrator-dashboard/openclaw.plugin.json"),
        ],
      },
    ];
    const externalRunnerScriptPath = resolvePath(
      repoRoot,
      "agent-orchestrator/scripts/orchestrate_runner_daemon.sh",
    );
    const runnerIntervalSec = asPositiveInt(cfg.runnerIntervalSec, DEFAULT_RUNNER_INTERVAL_SEC);
    const runnerTasksRootArg = path.relative(repoRoot, paths.taskFoldersRoot) || ".";
    const runnerExecutionMode = asExecutionMode(cfg.runnerExecutionMode, "local_threads");
    const runnerBatchSize = asPositiveInt(cfg.runnerBatchSize, 4);
    const runnerMaxParallel = asPositiveInt(cfg.runnerMaxParallel, 2);

    let runnerTimer: NodeJS.Timeout | null = null;
    let runnerTickRunning = false;
    let runnerLastTickAt = "";
    let runnerLastTickResult: "ok" | "failed" | "none" = "none";
    let runnerLastTickError = "";
    let runnerConsecutiveFailures = 0;
    let runnerStatus: "started" | "already_running" | "degraded" = "degraded";
    let runtimeConsistency: "ok" | "mismatch" = "ok";
    let runtimeSignature = "";
    let runtimeSignatureExpected = "";

    const emitEvent = async (
      eventType: string,
      payload: Record<string, unknown>,
      req?: IncomingMessage,
    ) => {
      await appendNdjson(eventsPath, {
        event_id: `evt_${randomUUID().replace(/-/g, "")}`,
        event_type: eventType,
        occurred_at: new Date().toISOString(),
        actor: req?.headers["x-openclaw-actor"] || "orchestrator-dashboard",
        resource: "orchestrator-config",
        payload,
        trace_id: `trace_${randomUUID().replace(/-/g, "")}`,
      });
    };

    const computeRuntimeSignature = async (): Promise<string> => {
      const hash = createHash("sha256");
      for (const fileSpec of runtimeSignatureFiles) {
        const filePath = resolveExistingPath(fileSpec.candidates);
        if (!filePath || !existsSync(filePath)) {
          throw new Error(`runtime signature source missing: ${fileSpec.id}`);
        }
        hash.update(fileSpec.id);
        hash.update("\n");
        const content = await fs.readFile(filePath, "utf8");
        hash.update(content);
        hash.update("\n");
      }
      return hash.digest("hex");
    };

    const loadExpectedRuntimeSignature = async (): Promise<string> => {
      const doc = await readJsonOrDefault<Record<string, unknown>>(runtimeSignaturePath, {});
      return asString(doc.signature, "");
    };

    const assertRuntimeConsistency = async (
      stage: "startup" | "command",
    ): Promise<{
      runtimeConsistency: "ok" | "mismatch";
      runtimeSignature: string;
      expected: string;
    }> => {
      const actual = await computeRuntimeSignature();
      const expected = await loadExpectedRuntimeSignature();
      runtimeSignature = actual;
      runtimeSignatureExpected = expected;
      if (expected && expected === actual) {
        runtimeConsistency = "ok";
        return { runtimeConsistency, runtimeSignature: runtimeSignature, expected };
      }

      runtimeConsistency = "mismatch";
      const message = buildRuntimeMismatchMessage({
        expectedSignature: expected || "(missing)",
        actualSignature: actual,
        signaturePath: runtimeSignaturePath,
      });
      await emitEvent("orchestrate.runtime.mismatch", {
        stage,
        expected_signature: expected || "(missing)",
        runtime_signature: actual,
        consistency_mode: cfg.runtimeConsistencyMode,
      });
      if (cfg.runtimeConsistencyMode === "enforce") {
        throw new Error(message);
      }
      return { runtimeConsistency, runtimeSignature: runtimeSignature, expected };
    };

    const getExternalRunnerStatus = async (): Promise<{
      running: boolean;
      pid: number;
      lastTickAt: string;
      lastExitCode: string;
      raw: string;
    }> => {
      if (!cfg.runnerFallbackEnabled || cfg.runnerFallbackMode !== "external_daemon") {
        return {
          running: false,
          pid: 0,
          lastTickAt: "",
          lastExitCode: "",
          raw: "",
        };
      }
      if (!(await fileExists(externalRunnerScriptPath))) {
        return {
          running: false,
          pid: 0,
          lastTickAt: "",
          lastExitCode: "",
          raw: "external daemon script missing",
        };
      }
      try {
        const result = await execFileAsync(externalRunnerScriptPath, ["status", "--json"], {
          cwd: repoRoot,
          timeout: 5000,
          maxBuffer: 128 * 1024,
        });
        const parsed = JSON.parse(String(result.stdout || "{}")) as Record<string, unknown>;
        return {
          running: asBoolean(parsed.running, false),
          pid: asPositiveInt(parsed.pid, 0),
          lastTickAt: asString(parsed.last_tick_at, ""),
          lastExitCode: asString(parsed.last_exit_code, ""),
          raw: trimOutput(String(result.stdout || "").trim(), 240),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          running: false,
          pid: 0,
          lastTickAt: "",
          lastExitCode: "",
          raw: trimOutput(message, 240),
        };
      }
    };

    let startupConsistencyError = "";
    const startupConsistencyPromise = assertRuntimeConsistency("startup").catch((err) => {
      startupConsistencyError = err instanceof Error ? err.message : String(err);
      return null;
    });

    const loadAgentRuntimeConfig = async (): Promise<AgentRuntimeConfig> => {
      const defaults: AgentRuntimeConfig = {
        llm: {
          enabled: false,
          authMode: "auto",
          apiBaseUrl: "https://api.openai.com/v1",
          apiKey: "",
          apiKeyEnv: "OPENAI_API_KEY",
          apiKeySource: "",
          model: "gpt-4.1-mini",
          temperature: 0.2,
          maxTokens: 500,
          timeoutMs: 20000,
          systemPrompt:
            "You are an orchestration planner. Return strict JSON only with optional keys: title, goal, risk_level, budget.",
        },
      };
      const localRuntimePath = paths.agentRuntimeConfig.replace(/\.json$/u, ".local.json");
      const [fromFile, fromLocal] = await Promise.all([
        readJsonOrDefault<Record<string, unknown>>(paths.agentRuntimeConfig, {}),
        readJsonOrDefault<Record<string, unknown>>(localRuntimePath, {}),
      ]);
      const merged = {
        ...fromFile,
        ...fromLocal,
        llm: {
          ...(fromFile.llm && typeof fromFile.llm === "object" ? (fromFile.llm as object) : {}),
          ...(fromLocal.llm && typeof fromLocal.llm === "object" ? (fromLocal.llm as object) : {}),
        },
      } as Record<string, unknown>;
      const llmRaw =
        merged.llm && typeof merged.llm === "object" && !Array.isArray(merged.llm)
          ? (merged.llm as Record<string, unknown>)
          : {};
      const apiKeyEnv = asString(llmRaw.api_key_env, defaults.llm.apiKeyEnv);
      const authModeRaw = asString(llmRaw.auth_mode, defaults.llm.authMode).toLowerCase();
      const authMode =
        authModeRaw === "standalone" || authModeRaw === "openclaw" ? authModeRaw : "auto";
      const model = asString(llmRaw.model, defaults.llm.model);
      const provider = (model.split("/")[0] || "openai").trim().toLowerCase();
      const explicitKey = asString(llmRaw.api_key, "");
      const envExplicitKey = process.env[apiKeyEnv]?.trim() || "";
      const providerKeyEnvMap: Record<string, string> = {
        openai: "OPENAI_API_KEY",
        "openai-codex": "OPENAI_API_KEY",
        google: "GEMINI_API_KEY",
        gemini: "GEMINI_API_KEY",
        minimax: "MINIMAX_API_KEY",
        moonshot: "MOONSHOT_API_KEY",
        openrouter: "OPENROUTER_API_KEY",
        together: "TOGETHER_API_KEY",
        xai: "XAI_API_KEY",
        zai: "ZAI_API_KEY",
      };
      const providerEnvName = providerKeyEnvMap[provider] || "";
      const providerEnvKey = providerEnvName ? process.env[providerEnvName]?.trim() || "" : "";
      const configRoot =
        api.config && typeof api.config === "object" ? (api.config as Record<string, unknown>) : {};
      const modelsCfg =
        configRoot.models && typeof configRoot.models === "object"
          ? (configRoot.models as Record<string, unknown>)
          : {};
      const providersCfg =
        modelsCfg.providers && typeof modelsCfg.providers === "object"
          ? (modelsCfg.providers as Record<string, unknown>)
          : {};
      const providerCandidates = [provider, provider.replace(/-.*$/u, ""), "openai"];
      let openClawProviderKey = "";
      for (const name of providerCandidates) {
        const entry =
          providersCfg[name] && typeof providersCfg[name] === "object"
            ? (providersCfg[name] as Record<string, unknown>)
            : {};
        const key = asString(entry.apiKey, "");
        if (key) {
          openClawProviderKey = key;
          break;
        }
      }
      let resolvedKey = "";
      let resolvedKeySource = "";
      const setResolved = (value: string, source: string) => {
        if (!resolvedKey && value) {
          resolvedKey = value;
          resolvedKeySource = source;
        }
      };
      if (authMode === "standalone" || authMode === "auto") {
        setResolved(explicitKey, "runtime.llm.api_key");
        setResolved(envExplicitKey, `env:${apiKeyEnv}`);
      }
      if (authMode === "openclaw" || authMode === "auto") {
        setResolved(openClawProviderKey, `openclaw.models.providers.${provider}.apiKey`);
        setResolved(providerEnvKey, providerEnvName ? `env:${providerEnvName}` : "");
      }
      const runtime: AgentRuntimeConfig = {
        llm: {
          enabled: asBoolean(llmRaw.enabled, defaults.llm.enabled),
          authMode,
          apiBaseUrl: asString(llmRaw.api_base_url, defaults.llm.apiBaseUrl).replace(/\/+$/u, ""),
          apiKey: resolvedKey,
          apiKeyEnv,
          apiKeySource: resolvedKeySource,
          model,
          temperature: clampNumber(Number(llmRaw.temperature ?? defaults.llm.temperature), 0, 1),
          maxTokens: asPositiveInt(llmRaw.max_tokens, defaults.llm.maxTokens),
          timeoutMs: asPositiveInt(llmRaw.timeout_ms, defaults.llm.timeoutMs),
          systemPrompt: asString(llmRaw.system_prompt, defaults.llm.systemPrompt),
        },
      };
      return runtime;
    };

    const enhanceStrategyWithLlm = async (params: {
      strategy: ReturnType<typeof normalizeFreeTextToStrategy>;
      freeText: string;
      operationId: string;
    }): Promise<{
      strategy: ReturnType<typeof normalizeFreeTextToStrategy>;
      used: boolean;
      reason: string;
      authMode: "auto" | "standalone" | "openclaw";
      keySource: string;
    }> => {
      const runtime = await loadAgentRuntimeConfig();
      if (!runtime.llm.enabled) {
        return {
          strategy: params.strategy,
          used: false,
          reason: "llm_disabled",
          authMode: runtime.llm.authMode,
          keySource: runtime.llm.apiKeySource,
        };
      }
      if (!runtime.llm.apiKey) {
        return {
          strategy: params.strategy,
          used: false,
          reason: "missing_api_key",
          authMode: runtime.llm.authMode,
          keySource: runtime.llm.apiKeySource,
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), runtime.llm.timeoutMs);
      try {
        const response = await fetch(`${runtime.llm.apiBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${runtime.llm.apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: runtime.llm.model,
            temperature: runtime.llm.temperature,
            max_tokens: runtime.llm.maxTokens,
            messages: [
              { role: "system", content: runtime.llm.systemPrompt },
              {
                role: "user",
                content: [
                  "Input request:",
                  params.freeText,
                  "",
                  "Current strategy JSON:",
                  JSON.stringify(params.strategy),
                  "",
                  "Return JSON only. Optional keys: title, goal, risk_level, budget.max_token_cost, budget.max_execution_time_seconds.",
                ].join("\n"),
              },
            ],
          }),
        });
        if (!response.ok) {
          const text = trimOutput(await response.text(), 500);
          await emitEvent("orchestrate.llm.plan_failed", {
            operation_id: params.operationId,
            status: response.status,
            error: text,
          });
          return {
            strategy: params.strategy,
            used: false,
            reason: "llm_http_error",
            authMode: runtime.llm.authMode,
            keySource: runtime.llm.apiKeySource,
          };
        }
        const payload = (await response.json()) as Record<string, unknown>;
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const first = choices[0] as Record<string, unknown> | undefined;
        const message =
          first && typeof first.message === "object" && first.message !== null
            ? (first.message as Record<string, unknown>)
            : {};
        const content = typeof message.content === "string" ? message.content : "";
        const parsedRaw = JSON.parse(normalizeResponseJson(content)) as Record<string, unknown>;
        const budgetRaw =
          parsedRaw.budget &&
          typeof parsedRaw.budget === "object" &&
          !Array.isArray(parsedRaw.budget)
            ? (parsedRaw.budget as Record<string, unknown>)
            : {};
        const next = {
          ...params.strategy,
          title: asString(parsedRaw.title, params.strategy.title).slice(0, 120),
          goal: asString(parsedRaw.goal, params.strategy.goal).slice(0, 2000),
          risk_level:
            parsedRaw.risk_level === "LOW" ||
            parsedRaw.risk_level === "MEDIUM" ||
            parsedRaw.risk_level === "HIGH"
              ? parsedRaw.risk_level
              : params.strategy.risk_level,
          budget: {
            max_token_cost: asPositiveInt(
              budgetRaw.max_token_cost,
              params.strategy.budget.max_token_cost,
            ),
            max_execution_time_seconds: asPositiveInt(
              budgetRaw.max_execution_time_seconds,
              params.strategy.budget.max_execution_time_seconds,
            ),
          },
        };
        await emitEvent("orchestrate.llm.plan_applied", {
          operation_id: params.operationId,
          model: runtime.llm.model,
          api_base_url: runtime.llm.apiBaseUrl,
          auth_mode: runtime.llm.authMode,
          api_key_source: runtime.llm.apiKeySource || "unknown",
        });
        return {
          strategy: next,
          used: true,
          reason: "ok",
          authMode: runtime.llm.authMode,
          keySource: runtime.llm.apiKeySource,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await emitEvent("orchestrate.llm.plan_failed", {
          operation_id: params.operationId,
          error: trimOutput(message, 500),
        });
        return {
          strategy: params.strategy,
          used: false,
          reason: "llm_exception",
          authMode: runtime.llm.authMode,
          keySource: runtime.llm.apiKeySource,
        };
      } finally {
        clearTimeout(timer);
      }
    };

    const getRunnerLockMtime = async (): Promise<string> => {
      try {
        const stat = await fs.stat(runnerLockPath);
        return stat.mtime.toISOString();
      } catch {
        return "";
      }
    };

    const readRunnerLockInfo = async (): Promise<{ pid: number; heartbeatIso: string }> => {
      try {
        const content = await fs.readFile(runnerLockPath, "utf8");
        const lines = content.split(/\r?\n/u);
        const pidRaw = String(lines[0] ?? "").trim();
        const heartbeatIso = String(lines[1] ?? "").trim();
        const pid = Number(pidRaw);
        return {
          pid: Number.isFinite(pid) && pid > 0 ? pid : 0,
          heartbeatIso,
        };
      } catch {
        return { pid: 0, heartbeatIso: "" };
      }
    };

    const isRunnerHeartbeatFresh = (heartbeatIso: string): boolean => {
      if (!heartbeatIso) {
        return false;
      }
      const heartbeatMs = Date.parse(heartbeatIso);
      if (!Number.isFinite(heartbeatMs)) {
        return false;
      }
      const ageMs = Date.now() - heartbeatMs;
      const staleMs = Math.max(runnerIntervalSec * 3000, 30_000);
      return ageMs >= 0 && ageMs <= staleMs;
    };

    const isProcessAlive = (pid: number): boolean => {
      if (!Number.isFinite(pid) || pid <= 0) {
        return false;
      }
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    const isRunnerLockHeldByOtherLiveProcess = async (): Promise<boolean> => {
      const { pid, heartbeatIso } = await readRunnerLockInfo();
      return (
        pid > 0 &&
        pid !== process.pid &&
        isProcessAlive(pid) &&
        isRunnerHeartbeatFresh(heartbeatIso)
      );
    };

    const acquireRunnerLock = async (): Promise<boolean> => {
      await fs.mkdir(path.dirname(runnerLockPath), { recursive: true });
      const payload = `${process.pid}\n${new Date().toISOString()}\n`;
      try {
        const handle = await fs.open(runnerLockPath, "wx");
        await handle.writeFile(payload, "utf8");
        await handle.close();
        return true;
      } catch {
        const lockInfo = await readRunnerLockInfo();
        const parsedPid = lockInfo.pid;
        if (Number.isFinite(parsedPid) && parsedPid > 0) {
          if (parsedPid === process.pid) {
            // Plugin reload in same gateway process: lock already belongs to us.
            await refreshRunnerLock();
            return true;
          }
          try {
            process.kill(parsedPid, 0);
            // A live lock holder that still heartbeats owns the lease.
            if (isRunnerHeartbeatFresh(lockInfo.heartbeatIso)) {
              return false;
            }
            // Lease heartbeat stale: reclaim lock to avoid permanent deadlock.
            await fs.unlink(runnerLockPath);
            const handle = await fs.open(runnerLockPath, "wx");
            await handle.writeFile(payload, "utf8");
            await handle.close();
            return true;
          } catch {
            // stale lock; reclaim below
          }
        }
        try {
          await fs.unlink(runnerLockPath);
        } catch {
          return false;
        }
        try {
          const handle = await fs.open(runnerLockPath, "wx");
          await handle.writeFile(payload, "utf8");
          await handle.close();
          return true;
        } catch {
          return false;
        }
      }
    };

    const refreshRunnerStatusFromLock = async (): Promise<void> => {
      if (await isRunnerLockHeldByOtherLiveProcess()) {
        runnerStatus = "already_running";
      } else {
        runnerStatus = "degraded";
      }
    };

    const refreshRunnerLock = async (): Promise<void> => {
      const payload = `${process.pid}\n${new Date().toISOString()}\n`;
      await fs.writeFile(runnerLockPath, payload, "utf8");
    };

    const tickRunner = async (): Promise<void> => {
      if (runnerTickRunning) {
        return;
      }
      runnerTickRunning = true;
      try {
        const onceResult = await runWhitelistedScript({
          repoRoot,
          scriptName: "orchestrate_multi_once",
          args: [
            runnerTasksRootArg,
            "--mode",
            runnerExecutionMode,
            "--max-parallel",
            String(runnerMaxParallel),
            "--max-tasks",
            String(runnerBatchSize),
          ],
          timeoutMs: 60_000,
          maxBufferBytes: 2 * 1024 * 1024,
        });
        runnerLastTickAt = new Date().toISOString();
        runnerLastTickResult = "ok";
        runnerLastTickError = "";
        runnerConsecutiveFailures = 0;
        runnerStatus = "started";
        let parsedTick: Record<string, unknown> = {};
        try {
          parsedTick = JSON.parse(onceResult.stdout || "{}") as Record<string, unknown>;
        } catch {
          parsedTick = {};
        }
        await refreshRunnerLock();
        await emitEvent("orchestrate.runner.tick_ok", {
          interval_sec: runnerIntervalSec,
          execution_mode: runnerExecutionMode,
          batch_size: runnerBatchSize,
          max_parallel: runnerMaxParallel,
          output: trimOutput(onceResult.stdout || onceResult.stderr || "ok", 240),
          last_tick_at: runnerLastTickAt,
          logical_threads: asPositiveInt(parsedTick.logical_threads, 4),
          effective_worker_threads: asPositiveInt(parsedTick.effective_worker_threads, 1),
          parallel_limit: asPositiveInt(parsedTick.parallel_limit, runnerMaxParallel),
          queue_depth: asPositiveInt(parsedTick.queue_depth, 0),
          policy_mode: asString(parsedTick.policy_mode, "enforce"),
          sandbox_status: asString(parsedTick.sandbox_status, "enabled"),
          commit_guard_status: asString(parsedTick.commit_guard_status, "enabled"),
          kb_import_confirm_required: asString(parsedTick.kb_import_confirm_required, "true"),
          kb_import_auto_enabled: asString(parsedTick.kb_import_auto_enabled, "false"),
          workspace_sync_sensitivity: asString(parsedTick.workspace_sync_sensitivity, "MEDIUM"),
          acl_denied_count: asPositiveInt(parsedTick.acl_denied_count, 0),
          acl_last_denied_at: asString(parsedTick.acl_last_denied_at, ""),
        });
        if (parsedTick.throttled === true) {
          await emitEvent("orchestrate.parallel.throttled", {
            requested_parallel: runnerMaxParallel,
            applied_parallel: asPositiveInt(parsedTick.parallel_limit, runnerMaxParallel),
            effective_worker_threads: asPositiveInt(parsedTick.effective_worker_threads, 1),
            last_tick_at: runnerLastTickAt,
          });
        }
        if (asPositiveInt(parsedTick.acl_denied_count, 0) > 0) {
          await emitEvent("orchestrate.acl.denied", {
            acl_denied_count: asPositiveInt(parsedTick.acl_denied_count, 0),
            acl_last_denied_at: asString(parsedTick.acl_last_denied_at, ""),
            policy_mode: asString(parsedTick.policy_mode, "enforce"),
          });
        }
      } catch (err) {
        runnerLastTickAt = new Date().toISOString();
        runnerLastTickResult = "failed";
        runnerConsecutiveFailures += 1;
        if (runnerConsecutiveFailures >= RUNNER_DEGRADED_THRESHOLD) {
          runnerStatus = "degraded";
        }
        const message = err instanceof Error ? err.message : String(err);
        runnerLastTickError = trimOutput(message, 400);
        await emitEvent("orchestrate.runner.tick_failed", {
          interval_sec: runnerIntervalSec,
          execution_mode: runnerExecutionMode,
          batch_size: runnerBatchSize,
          max_parallel: runnerMaxParallel,
          error: runnerLastTickError,
          consecutive_failures: runnerConsecutiveFailures,
          last_tick_at: runnerLastTickAt,
          status: runnerStatus,
        });
      } finally {
        try {
          // Keep lock freshness observable even when tick fails.
          await refreshRunnerLock();
        } catch {
          // ignore lock heartbeat write errors
        }
        runnerTickRunning = false;
      }
    };

    const ensureRunnerStarted = async (): Promise<{
      schedulerStatus: "started" | "already_running" | "degraded";
      lastTickAt: string;
      intervalSec: number;
    }> => {
      if (!cfg.runnerEnabled) {
        runnerStatus = "degraded";
        return {
          schedulerStatus: "degraded",
          lastTickAt: runnerLastTickAt,
          intervalSec: runnerIntervalSec,
        };
      }
      if (runnerTimer) {
        runnerStatus = runnerStatus === "degraded" ? "degraded" : "already_running";
        return {
          schedulerStatus: runnerStatus,
          lastTickAt: runnerLastTickAt,
          intervalSec: runnerIntervalSec,
        };
      }

      const lockAcquired = await acquireRunnerLock();
      if (!lockAcquired) {
        await refreshRunnerStatusFromLock();
        return {
          schedulerStatus: runnerStatus,
          lastTickAt: runnerLastTickAt,
          intervalSec: runnerIntervalSec,
        };
      }

      runnerStatus = "started";
      await emitEvent("orchestrate.runner.started", {
        interval_sec: runnerIntervalSec,
        execution_mode: runnerExecutionMode,
        batch_size: runnerBatchSize,
        max_parallel: runnerMaxParallel,
        lock_path: runnerLockPath,
      });

      runnerTimer = setInterval(() => {
        void tickRunner();
      }, runnerIntervalSec * 1000);
      void tickRunner();

      return {
        schedulerStatus: "started",
        lastTickAt: runnerLastTickAt,
        intervalSec: runnerIntervalSec,
      };
    };

    void startupConsistencyPromise.then(async (result) => {
      if (!result || !cfg.runnerEnabled) {
        return;
      }
      try {
        await ensureRunnerStarted();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await emitEvent("orchestrate.runner.start_failed", {
          stage: "plugin_startup",
          error: trimOutput(message, 400),
        });
      }
    });

    const loadExecutionRuntime = async (): Promise<{
      logicalThreads: number;
      effectiveWorkerThreads: number;
      parallelLimit: number;
      queueDepth: number;
      policyMode: string;
      rolePolicyPath: string;
      workdomainRoot: string;
      aclDeniedCount: number;
      aclLastDeniedAt: string;
      sandboxEnabled: boolean;
      commitGuardEnabled: boolean;
      kbImportConfirmRequired: boolean;
      kbImportAutoEnabled: boolean;
      workspaceSyncSensitivity: string;
      projectsRoot: string;
      skillMcpIsolationEnabled: boolean;
      protectOrchestratorConfig: boolean;
      projectRuntimeProfile: string;
      orchestratorRuntimeProfile: string;
    }> => {
      const runtime = await readJsonOrDefault<Record<string, unknown>>(paths.executionRuntime, {});
      const host =
        runtime.host && typeof runtime.host === "object" && !Array.isArray(runtime.host)
          ? (runtime.host as Record<string, unknown>)
          : {};
      const localThreads =
        runtime.local_threads &&
        typeof runtime.local_threads === "object" &&
        !Array.isArray(runtime.local_threads)
          ? (runtime.local_threads as Record<string, unknown>)
          : {};
      const dashboard = await readJsonOrDefault<Record<string, unknown>>(paths.dashboardJson, {});
      const security =
        runtime.security && typeof runtime.security === "object" && !Array.isArray(runtime.security)
          ? (runtime.security as Record<string, unknown>)
          : {};
      const workdomain =
        runtime.workdomain &&
        typeof runtime.workdomain === "object" &&
        !Array.isArray(runtime.workdomain)
          ? (runtime.workdomain as Record<string, unknown>)
          : {};
      const workspace =
        runtime.workspace &&
        typeof runtime.workspace === "object" &&
        !Array.isArray(runtime.workspace)
          ? (runtime.workspace as Record<string, unknown>)
          : {};
      const kbImport =
        runtime.kb_import &&
        typeof runtime.kb_import === "object" &&
        !Array.isArray(runtime.kb_import)
          ? (runtime.kb_import as Record<string, unknown>)
          : {};
      const sync =
        runtime.sync && typeof runtime.sync === "object" && !Array.isArray(runtime.sync)
          ? (runtime.sync as Record<string, unknown>)
          : {};
      const isolation =
        runtime.agent_runtime_isolation &&
        typeof runtime.agent_runtime_isolation === "object" &&
        !Array.isArray(runtime.agent_runtime_isolation)
          ? (runtime.agent_runtime_isolation as Record<string, unknown>)
          : {};
      const deniedRel = asString(
        security.denied_events_path,
        "templates/coordination/security/acl_denied.ndjson",
      );
      const deniedPath = resolvePath(repoRoot, deniedRel);
      let aclDeniedCount = 0;
      let aclLastDeniedAt = "";
      if (await fileExists(deniedPath)) {
        const lines = (await readText(deniedPath))
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        aclDeniedCount = lines.length;
        if (lines.length > 0) {
          try {
            const last = JSON.parse(lines[lines.length - 1] ?? "{}") as Record<string, unknown>;
            aclLastDeniedAt = String(last.timestamp ?? "");
          } catch {
            aclLastDeniedAt = "";
          }
        }
      }
      const active = Array.isArray(dashboard.active_pipelines)
        ? dashboard.active_pipelines.length
        : 0;
      return {
        logicalThreads: asPositiveInt(host.logical_threads, 4),
        effectiveWorkerThreads: asPositiveInt(host.effective_worker_threads, 1),
        parallelLimit: asPositiveInt(localThreads.max_parallel, 1),
        queueDepth: active,
        policyMode: asString(security.policy_mode, "enforce"),
        rolePolicyPath: asString(
          security.role_policy_path,
          "templates/coordination/security/role_permissions.effective.json",
        ),
        workdomainRoot: asString(workdomain.root, "runtime/workdomains"),
        aclDeniedCount,
        aclLastDeniedAt,
        sandboxEnabled: asBoolean(security.sandbox_enabled, true),
        commitGuardEnabled: asBoolean(security.commit_guard_enabled, true),
        kbImportConfirmRequired: asBoolean(kbImport.confirm_required, true),
        kbImportAutoEnabled: asBoolean(kbImport.auto_enabled, false),
        workspaceSyncSensitivity: asString(sync.workspace_sync_sensitivity, "MEDIUM"),
        projectsRoot: asString(workspace.projects_root, "projects"),
        skillMcpIsolationEnabled: asBoolean(isolation.enabled, true),
        protectOrchestratorConfig: asBoolean(isolation.protect_orchestrator_config, true),
        projectRuntimeProfile: asString(isolation.project_profile_name, "project_execution"),
        orchestratorRuntimeProfile: asString(
          isolation.orchestrator_profile_name,
          "orchestrator_control",
        ),
      };
    };

    const readPathState = async (): Promise<PathState> => {
      const fallback: PathState = {
        schema_version: "orchestrate-path-state-v1",
        updated_at: new Date(0).toISOString(),
        projects: {},
      };
      const raw = await readJsonOrDefault<Record<string, unknown>>(paths.pathState, fallback);
      const projectsRaw =
        raw.projects && typeof raw.projects === "object" && !Array.isArray(raw.projects)
          ? (raw.projects as Record<string, unknown>)
          : {};
      const projects: Record<string, PathStateProjectEntry> = {};
      for (const [projectId, value] of Object.entries(projectsRaw)) {
        if (!isSafeProjectId(projectId)) {
          continue;
        }
        const row =
          value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
        const workspaceRoot = asString(row.workspace_root, "");
        const updatedAt = asString(row.updated_at, "");
        const updatedBy = asString(row.updated_by, "");
        if (!workspaceRoot) {
          continue;
        }
        projects[projectId] = {
          workspace_root: workspaceRoot,
          updated_at: updatedAt || new Date().toISOString(),
          updated_by: updatedBy || "unknown",
        };
      }
      return {
        schema_version: "orchestrate-path-state-v1",
        updated_at: asString(raw.updated_at, new Date().toISOString()),
        projects,
      };
    };

    const writePathState = async (next: PathState): Promise<void> => {
      await writeJsonAtomic(paths.pathState, next);
    };

    const readOrchestrateSession = async (
      sessionKey: string,
    ): Promise<OrchestrateSessionState | null> => {
      if (!sessionKey) {
        return null;
      }
      const sessionPath = buildSessionFilePath(paths.orchestrateSessionsDir, sessionKey);
      if (!(await fileExists(sessionPath))) {
        return null;
      }
      const fallback = buildEmptyOrchestrateSession({
        sessionKey,
        channel: "unknown",
        senderId: "unknown",
      });
      const raw = await readJsonOrDefault<Record<string, unknown>>(sessionPath, fallback);
      return normalizeOrchestrateSession(raw, { fallbackSession: fallback });
    };

    const writeOrchestrateSession = async (next: OrchestrateSessionState): Promise<void> => {
      await writeJsonAtomic(buildSessionFilePath(paths.orchestrateSessionsDir, next.session_key), next);
    };

    const resolveWorkspaceConfigForRun = async (params: {
      runtimeStats: Awaited<ReturnType<typeof loadExecutionRuntime>>;
      projectIdFromFlag: string;
      workspaceRootFromFlag: string;
      taskId: string;
    }): Promise<{
      projectId: string;
      workspaceRoot: string;
      source: WorkspaceConfigSource;
      validated: boolean;
    }> => {
      const pathState = await readPathState();
      const projectIdFlag = params.projectIdFromFlag.trim();
      const workspaceFlag = params.workspaceRootFromFlag.trim();

      if (workspaceFlag && !projectIdFlag) {
        throw new Error("run with --workspace-root requires --project-id");
      }
      if (projectIdFlag && !isSafeProjectId(projectIdFlag)) {
        throw new Error("invalid --project-id");
      }
      if (workspaceFlag) {
        const err = validateWorkspaceRootRelative(workspaceFlag);
        if (err) {
          throw new Error(`invalid --workspace-root: ${err}`);
        }
        resolveWorkspaceUnderProjects({
          repoRoot,
          projectsRootRel: params.runtimeStats.projectsRoot,
          workspaceRootRel: workspaceFlag,
        });
        return {
          projectId: projectIdFlag,
          workspaceRoot: workspaceFlag,
          source: "run_flag",
          validated: true,
        };
      }

      const projectForPath = projectIdFlag || "prj_default";
      const projectDefault = pathState.projects[projectForPath];
      if (projectDefault) {
        const err = validateWorkspaceRootRelative(projectDefault.workspace_root);
        if (!err) {
          resolveWorkspaceUnderProjects({
            repoRoot,
            projectsRootRel: params.runtimeStats.projectsRoot,
            workspaceRootRel: projectDefault.workspace_root,
          });
          return {
            projectId: projectForPath,
            workspaceRoot: projectDefault.workspace_root,
            source: "path_default",
            validated: true,
          };
        }
      }

      return {
        projectId: projectIdFlag || "prj_default",
        workspaceRoot: `${projectIdFlag || "prj_default"}/runs/${params.taskId}/workspace`,
        source: "runtime_default",
        validated: true,
      };
    };

    const loadCurrentConfig = async () => {
      const [currentRaw, propsRaw, policy] = await Promise.all([
        readText(paths.plannerCurrent),
        readText(paths.plannerProperties),
        readJsonOrDefault<Record<string, unknown>>(paths.auditPolicy, {}),
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
        draft.plannerCurrent &&
        typeof draft.plannerCurrent === "object" &&
        !Array.isArray(draft.plannerCurrent)
          ? (draft.plannerCurrent as Record<string, unknown>)
          : {};
      const plannerProperties =
        draft.plannerProperties &&
        typeof draft.plannerProperties === "object" &&
        !Array.isArray(draft.plannerProperties)
          ? (draft.plannerProperties as Record<string, unknown>)
          : {};
      const auditPolicy =
        draft.auditPolicy &&
        typeof draft.auditPolicy === "object" &&
        !Array.isArray(draft.auditPolicy)
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
          JSON.stringify(base.auditPolicy) === JSON.stringify(auditPolicy)
            ? []
            : ["rules", "version"],
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
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      try {
        const handle = await fs.open(lockPath, "wx");
        await handle.writeFile(String(process.pid));
        await handle.close();
        return true;
      } catch {
        return false;
      }
    };

    const releaseLock = async (): Promise<void> => {
      try {
        await fs.unlink(lockPath);
      } catch {
        // ignore
      }
    };

    api.on("before_agent_start", async (event, ctx) => {
      const sessionKey = (ctx.sessionKey ?? "").trim();
      if (!sessionKey) {
        return;
      }
      const existing = await readOrchestrateSession(sessionKey);
      if (
        !existing ||
        (existing.status !== "ACTIVE_DRAFTING" && existing.status !== "SUMMARY_READY")
      ) {
        return;
      }
      const latestUserMessage = extractLatestUserMessage(
        Array.isArray(event.messages) ? event.messages : undefined,
      );
      let next = existing;
      if (latestUserMessage && !latestUserMessage.startsWith("/")) {
        next = applyMessageToDraft(existing, latestUserMessage);
        await writeOrchestrateSession(next);
      }
      return {
        prependContext: buildEntryAgentContext(next),
      };
    });

    api.registerCommand({
      name: "orchestrate",
      description: "Run orchestrator entry agent: /orchestrate start|summary|run|status|help",
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => {
        await startupConsistencyPromise;
        if (startupConsistencyError) {
          return { text: startupConsistencyError };
        }
        const parsed = parseOrchestrateArgs(ctx.args);
        let consistencyInfo: {
          runtimeConsistency: "ok" | "mismatch";
          runtimeSignature: string;
          expected: string;
        } | null = null;
        try {
          consistencyInfo = await assertRuntimeConsistency("command");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { text: message };
        }
        if (parsed.subcommand === "help") {
          return { text: renderOrchestrateHelp() };
        }

        if (parsed.subcommand === "start") {
          const sessionKey = resolveConversationSessionKey(ctx);
          if (!sessionKey) {
            return { text: "orchestrate start failed: missing session key" };
          }
          const existing = await readOrchestrateSession(sessionKey);
          if (existing && existing.status !== "CLOSED") {
            return {
              text: [
                "orchestrate session already active",
                renderSessionSummary(existing),
                "",
                "continue by sending normal messages, then use /orchestrate summary",
              ].join("\n"),
            };
          }
          const created = buildEmptyOrchestrateSession({
            sessionKey,
            channel: ctx.channel,
            senderId: ctx.senderId ?? "unknown",
          });
          await writeOrchestrateSession(created);
          await emitEvent("orchestrate.session.started", {
            session_key: sessionKey,
            channel: ctx.channel,
            sender_id: ctx.senderId ?? "unknown",
          });
          return {
            text: [
              "orchestrate mode activated",
              renderSessionSummary(created),
              "",
              "send normal messages to describe the task and configuration",
              "use /orchestrate summary when you want a structured recap",
            ].join("\n"),
          };
        }

        if (parsed.subcommand === "session") {
          const sessionKey = resolveConversationSessionKey(ctx);
          if (!sessionKey) {
            return { text: "orchestrate session failed: missing session key" };
          }
          const session = await readOrchestrateSession(sessionKey);
          if (!session || session.status === "CLOSED") {
            return { text: "no active orchestrate session\n\nuse /orchestrate start" };
          }
          return { text: renderSessionSummary(session) };
        }

        if (parsed.subcommand === "stop") {
          const sessionKey = resolveConversationSessionKey(ctx);
          if (!sessionKey) {
            return { text: "orchestrate stop failed: missing session key" };
          }
          const session = await readOrchestrateSession(sessionKey);
          if (!session) {
            return { text: "no active orchestrate session" };
          }
          const next: OrchestrateSessionState = {
            ...session,
            status: "CLOSED",
            updated_at: new Date().toISOString(),
          };
          await writeOrchestrateSession(next);
          await emitEvent("orchestrate.session.closed", {
            session_key: sessionKey,
            reason: "user_stop",
          });
          return { text: "orchestrate session closed" };
        }

        if (parsed.subcommand === "summary") {
          const sessionKey = resolveConversationSessionKey(ctx);
          if (!sessionKey) {
            return { text: "orchestrate summary failed: missing session key" };
          }
          const session = await readOrchestrateSession(sessionKey);
          if (!session || session.status === "CLOSED") {
            return { text: "no active orchestrate session\n\nuse /orchestrate start" };
          }
          if (!session.draft.task_goal.trim()) {
            return {
              text: "cannot create summary: task goal is empty\n\nsend normal messages to describe the task first",
            };
          }
          const previous = session.latest_summary;
          const summary = buildSummaryFromDraft(session);
          const summaryPath = buildSummaryFilePath(
            paths.orchestrateRequestsDir,
            sessionKey,
            summary.summary_id,
          );
          if (previous) {
            await writeJsonAtomic(
              buildSummaryFilePath(paths.orchestrateRequestsDir, sessionKey, previous.summary_id),
              {
              session_key: sessionKey,
              summary: {
                ...previous,
                status: "superseded",
              },
              },
            );
          }
          const next: OrchestrateSessionState = appendSessionHistory(
            {
              ...session,
              status: "SUMMARY_READY",
              updated_at: new Date().toISOString(),
              latest_summary: summary,
            },
            {
              timestamp: summary.created_at,
              role: "entry_agent",
              kind: "summary",
              content: summary.summary_id,
            },
          );
          await writeJsonAtomic(summaryPath, {
            session_key: sessionKey,
            summary,
          });
          await writeOrchestrateSession(next);
          await emitEvent("orchestrate.session.summary_created", {
            session_key: sessionKey,
            summary_id: summary.summary_id,
            summary_path: summaryPath,
            version: summary.version,
          });
          return {
            text: [
              `summary_id: ${summary.summary_id}`,
              `summary_version: ${String(summary.version)}`,
              `task_goal: ${summary.content.task_goal}`,
              `project_id: ${summary.content.project_id || "(default)"}`,
              `workspace_root: ${summary.content.workspace_root || "(default)"}`,
              `risk_level: ${summary.content.risk_level}`,
              `budget: ${summary.content.budget.max_token_cost},${summary.content.budget.max_execution_time_seconds}`,
              `requested_mode: ${summary.content.requested_mode}`,
              `deliverables: ${summary.content.deliverables.join(", ") || "(none)"}`,
              `constraints: ${summary.content.constraints.join(", ") || "(none)"}`,
              `summary_path: ${summaryPath}`,
              "",
              "if you want changes, keep chatting and run /orchestrate summary again",
              "when ready, run /orchestrate run",
            ].join("\n"),
          };
        }

        if (parsed.subcommand === "path") {
          const { flags, positionals } = parseKvFlags(parsed.payload);
          const action = (positionals[0] ?? "").toLowerCase();
          const projectId = (flags["project-id"] ?? "").trim();
          const workspaceRoot = (flags["workspace-root"] ?? "").trim();

          if (!action || !["set", "get", "clear", "list"].includes(action)) {
            return { text: "usage: /orchestrate path set|get|clear|list ..." };
          }
          if (action !== "list") {
            if (!projectId || !isSafeProjectId(projectId)) {
              return { text: "path command requires valid --project-id" };
            }
          }

          const runtimeStats = await loadExecutionRuntime();
          const state = await readPathState();

          if (action === "list") {
            const rows = Object.entries(state.projects)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(
                ([pid, row]) =>
                  `- ${pid} workspace_root=${row.workspace_root} updated_at=${row.updated_at} updated_by=${row.updated_by}`,
              );
            return {
              text: [
                `schema_version: ${state.schema_version}`,
                `updated_at: ${state.updated_at}`,
                rows.length > 0 ? "projects:" : "projects: (none)",
                ...rows,
              ].join("\n"),
            };
          }

          if (action === "get") {
            const row = state.projects[projectId];
            if (!row) {
              return { text: `project_id: ${projectId}\nworkspace_root: (not set)` };
            }
            return {
              text: [
                `project_id: ${projectId}`,
                `workspace_root: ${row.workspace_root}`,
                `updated_at: ${row.updated_at}`,
                `updated_by: ${row.updated_by}`,
              ].join("\n"),
            };
          }

          if (action === "clear") {
            if (state.projects[projectId]) {
              delete state.projects[projectId];
              state.updated_at = new Date().toISOString();
              await writePathState(state);
            }
            return { text: `project_id: ${projectId}\nworkspace_root: (cleared)` };
          }

          const err = validateWorkspaceRootRelative(workspaceRoot);
          if (err) {
            return { text: `invalid --workspace-root: ${err}` };
          }
          try {
            resolveWorkspaceUnderProjects({
              repoRoot,
              projectsRootRel: runtimeStats.projectsRoot,
              workspaceRootRel: workspaceRoot,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { text: `invalid --workspace-root: ${message}` };
          }

          const updatedAt = new Date().toISOString();
          state.projects[projectId] = {
            workspace_root: workspaceRoot,
            updated_at: updatedAt,
            updated_by: ctx.senderId?.trim() || "session_or_actor",
          };
          state.updated_at = updatedAt;
          await writePathState(state);
          return {
            text: [
              `project_id: ${projectId}`,
              `workspace_root: ${workspaceRoot}`,
              `projects_root: ${runtimeStats.projectsRoot}`,
              "status: set",
            ].join("\n"),
          };
        }

        if (parsed.subcommand === "status") {
          // Self-heal: if runner timer wasn't started for any reason, try to start it on status reads.
          if (cfg.runnerEnabled && !runnerTimer) {
            try {
              await ensureRunnerStarted();
            } catch {
              // keep status query non-fatal
            }
          }
          const taskId = parsed.payload.trim();
          if (!taskId) {
            const [dashboard, health, lockMtime, runtimeStats, externalRunner] = await Promise.all([
              readJsonOrDefault<Record<string, unknown>>(paths.dashboardJson, {}),
              readJsonOrDefault<Record<string, unknown>>(paths.systemHealthJson, {}),
              getRunnerLockMtime(),
              loadExecutionRuntime(),
              getExternalRunnerStatus(),
            ]);
            const active = Array.isArray(dashboard.active_pipelines)
              ? dashboard.active_pipelines
              : [];
            const top = active.slice(0, 5).map((item) => {
              const task = String((item as Record<string, unknown>).task_id ?? "unknown");
              const state = String((item as Record<string, unknown>).state ?? "UNKNOWN");
              const owner = String((item as Record<string, unknown>).owner ?? "n/a");
              return `- ${task} ${state} owner=${owner}`;
            });
            return {
              text: [
                `active_tasks: ${String(active.length)}`,
                `system_status: ${String((health as Record<string, unknown>).status ?? "UNKNOWN")}`,
                `scheduler_status: ${runnerStatus}`,
                `last_tick_at: ${runnerLastTickAt || "(none)"}`,
                `last_tick_result: ${runnerLastTickResult}${runnerLastTickError ? ` (${runnerLastTickError})` : ""}`,
                `runner_interval_sec: ${String(runnerIntervalSec)}`,
                `runner_execution_mode: ${runnerExecutionMode}`,
                `runner_batch_size: ${String(runnerBatchSize)}`,
                `runner_max_parallel: ${String(runnerMaxParallel)}`,
                `logical_threads: ${String(runtimeStats.logicalThreads)}`,
                `effective_worker_threads: ${String(runtimeStats.effectiveWorkerThreads)}`,
                `parallel_limit: ${String(runtimeStats.parallelLimit)}`,
                `queue_depth: ${String(runtimeStats.queueDepth)}`,
                `policy_mode: ${runtimeStats.policyMode}`,
                `role_policy_path: ${runtimeStats.rolePolicyPath}`,
                `workspace_root: ${runtimeStats.workdomainRoot}`,
                `projects_root: ${runtimeStats.projectsRoot}`,
                `sandbox_status: ${runtimeStats.sandboxEnabled ? "enabled" : "disabled"}`,
                `commit_guard_status: ${runtimeStats.commitGuardEnabled ? "enabled" : "disabled"}`,
                `kb_import_confirm_required: ${runtimeStats.kbImportConfirmRequired ? "true" : "false"}`,
                `kb_import_auto_enabled: ${runtimeStats.kbImportAutoEnabled ? "true" : "false"}`,
                `workspace_sync_sensitivity: ${runtimeStats.workspaceSyncSensitivity}`,
                `skill_mcp_isolation_enabled: ${runtimeStats.skillMcpIsolationEnabled ? "true" : "false"}`,
                `protect_orchestrator_config: ${runtimeStats.protectOrchestratorConfig ? "true" : "false"}`,
                `project_runtime_profile: ${runtimeStats.projectRuntimeProfile}`,
                `orchestrator_runtime_profile: ${runtimeStats.orchestratorRuntimeProfile}`,
                `acl_denied_count: ${String(runtimeStats.aclDeniedCount)}`,
                `acl_last_denied_at: ${runtimeStats.aclLastDeniedAt || "(none)"}`,
                `runner_lock_mtime: ${lockMtime || "(none)"}`,
                `runtime_consistency: ${consistencyInfo?.runtimeConsistency || runtimeConsistency}`,
                `runtime_signature: ${runtimeSignature || "(none)"}`,
                `runtime_expected_signature: ${runtimeSignatureExpected || "(none)"}`,
                `external_runner_running: ${externalRunner.running ? "true" : "false"}`,
                `external_runner_pid: ${externalRunner.pid > 0 ? String(externalRunner.pid) : "(none)"}`,
                `external_runner_last_tick_at: ${externalRunner.lastTickAt || "(none)"}`,
                `external_runner_last_exit_code: ${externalRunner.lastExitCode || "(none)"}`,
                runnerStatus === "degraded" && cfg.runnerFallbackEnabled
                  ? "runner_fallback_hint: bash agent-orchestrator/scripts/orchestrate_runner_daemon.sh start 10"
                  : "runner_fallback_hint: (none)",
                top.length > 0 ? "top_active:" : "top_active: (none)",
                ...top,
              ].join("\n"),
            };
          }
          if (!taskId || !/^[A-Za-z0-9._-]+$/u.test(taskId)) {
            return { text: `invalid task_id\n\n${renderOrchestrateHelp()}` };
          }
          const taskDir = path.join(paths.taskFoldersRoot, taskId);
          const metaPath = path.join(taskDir, "meta.json");
          const logPath = path.join(taskDir, "log.ndjson");
          const amendmentsPath = path.join(taskDir, "amendments.md");
          if (!(await fileExists(metaPath))) {
            return { text: `task not found: ${taskId}` };
          }
          const meta = await readJsonOrDefault<Record<string, unknown>>(metaPath, {});
          const events = await readNdjson(logPath);
          let amendmentCount = 0;
          let lastAmendment = "";
          if (await fileExists(amendmentsPath)) {
            const raw = await readText(amendmentsPath);
            const lines = raw
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line.startsWith("- "));
            amendmentCount = lines.length;
            lastAmendment = (lines[lines.length - 1] ?? "").replace(/^- /u, "");
          }
          const recent = events.slice(-3).map((entry) => {
            const action = String(entry.action ?? "UNKNOWN");
            const afterState = String(entry.after_state ?? "");
            const timestamp = String(entry.timestamp ?? "");
            return `${timestamp} ${action} ${afterState}`.trim();
          });
          const [lockMtime, runtimeStats, externalRunner] = await Promise.all([
            getRunnerLockMtime(),
            loadExecutionRuntime(),
            getExternalRunnerStatus(),
          ]);
          const splitUnitsPlanned = asPositiveInt(
            (meta as Record<string, unknown>).split_units_planned,
            1,
          );
          const requestedMode = String(meta.requested_mode ?? "auto");
          const resolvedMode = String(
            meta.execution_mode ??
              (Array.isArray(meta.children) && meta.children.length > 0 ? "multi" : "single"),
          );
          const planningDecision =
            meta.planning_decision &&
            typeof meta.planning_decision === "object" &&
            !Array.isArray(meta.planning_decision)
              ? (meta.planning_decision as Record<string, unknown>)
              : {};
          const acl =
            meta.acl && typeof meta.acl === "object" && !Array.isArray(meta.acl)
              ? (meta.acl as Record<string, unknown>)
              : {};
          const aggregate =
            meta.aggregate && typeof meta.aggregate === "object" && !Array.isArray(meta.aggregate)
              ? (meta.aggregate as Record<string, unknown>)
              : {};
          const executionRoles =
            meta.execution_roles &&
            typeof meta.execution_roles === "object" &&
            !Array.isArray(meta.execution_roles)
              ? (meta.execution_roles as Record<string, unknown>)
              : {};
          return {
            text: [
              `task_id: ${taskId}`,
              `state: ${String(meta.state ?? "UNKNOWN")}`,
              `version: ${String(meta.version ?? "n/a")}`,
              `scheduler_status: ${runnerStatus}`,
              `last_tick_at: ${runnerLastTickAt || "(none)"}`,
              `last_tick_result: ${runnerLastTickResult}${runnerLastTickError ? ` (${runnerLastTickError})` : ""}`,
              `runner_interval_sec: ${String(runnerIntervalSec)}`,
              `runner_execution_mode: ${runnerExecutionMode}`,
              `runner_batch_size: ${String(runnerBatchSize)}`,
              `runner_max_parallel: ${String(runnerMaxParallel)}`,
              `logical_threads: ${String(runtimeStats.logicalThreads)}`,
              `effective_worker_threads: ${String(runtimeStats.effectiveWorkerThreads)}`,
              `requested_mode: ${requestedMode}`,
              `resolved_mode: ${resolvedMode}`,
              `decision_source: ${String(planningDecision.decision_source ?? "(none)")}`,
              `decision_reason: ${String(planningDecision.decision_reason ?? "(none)")}`,
              `children_count: ${String(Array.isArray(meta.children) ? meta.children.length : 0)}`,
              `split_units_planned: ${String(splitUnitsPlanned)}`,
              `parallel_limit: ${String(runtimeStats.parallelLimit)}`,
              `queue_depth: ${String(runtimeStats.queueDepth)}`,
              `policy_mode: ${runtimeStats.policyMode}`,
              `role_policy_version: ${String(meta.role_constraints_version ?? "unknown")}`,
              `work_domain_id: ${String(meta.work_domain_id ?? "(none)")}`,
              `workspace_root: ${String(meta.workspace_root ?? runtimeStats.workdomainRoot)}`,
              `workspace_config_source: ${String(meta.workspace_config_source ?? "runtime_default")}`,
              `workspace_validated: ${String((meta.workspace_validated as boolean | undefined) === false ? "false" : "true")}`,
              `planning_actor: ${String(executionRoles.planning_actor ?? "planner-core")}`,
              `scheduling_actor: ${String(executionRoles.scheduling_actor ?? "scheduler-ops")}`,
              `actor_compat_mode: ${String((executionRoles.compat_mode as boolean | undefined) ? "true" : "false")}`,
              `actor_compat_hits: ${String(executionRoles.compat_hits ?? 0)}`,
              `aggregate_publish_status: ${String(aggregate.publish_status ?? "none")}`,
              `aggregate_manifest: ${String(aggregate.manifest_path ?? "(none)")}`,
              `aggregate_audit_status: ${String((meta as Record<string, unknown>).aggregate_audit_status ?? (aggregate.publish_status === "audited_pass" || aggregate.publish_status === "published" ? "PASS" : aggregate.publish_status === "audited_fail" || aggregate.publish_status === "rolled_back" ? "FAIL" : "(none)"))}`,
              `aggregate_collisions_count: ${String((meta as Record<string, unknown>).aggregate_collisions_count ?? 0)}`,
              `aggregate_last_block_reason: ${String(aggregate.last_block_reason ?? "(none)")}`,
              `run_root: ${String(meta.run_root ?? "(none)")}`,
              `project_id: ${String(meta.project_id ?? "prj_default")}`,
              `orchestrate_session_key: ${String(meta.orchestrate_session_key ?? "(none)")}`,
              `summary_id: ${String(meta.summary_id ?? "(none)")}`,
              `summary_path: ${String(meta.summary_path ?? "(none)")}`,
              `input_source: ${String(meta.input_source ?? "(none)")}`,
              `acl_denied_count: ${String(acl.denied_count ?? runtimeStats.aclDeniedCount)}`,
              `acl_last_denied_at: ${String((acl.last_denied_at ?? runtimeStats.aclLastDeniedAt) || "(none)")}`,
              `sandbox_status: ${runtimeStats.sandboxEnabled ? "enabled" : "disabled"}`,
              `commit_guard_status: ${runtimeStats.commitGuardEnabled ? "enabled" : "disabled"}`,
              `kb_import_confirm_required: ${runtimeStats.kbImportConfirmRequired ? "true" : "false"}`,
              `kb_import_auto_enabled: ${runtimeStats.kbImportAutoEnabled ? "true" : "false"}`,
              `workspace_sync_sensitivity: ${runtimeStats.workspaceSyncSensitivity}`,
              `skill_mcp_isolation_enabled: ${runtimeStats.skillMcpIsolationEnabled ? "true" : "false"}`,
              `protect_orchestrator_config: ${runtimeStats.protectOrchestratorConfig ? "true" : "false"}`,
              `project_runtime_profile: ${runtimeStats.projectRuntimeProfile}`,
              `orchestrator_runtime_profile: ${runtimeStats.orchestratorRuntimeProfile}`,
              `workspace_user_change_seq: ${String(meta.workspace_user_change_seq ?? 0)}`,
              `workspace_last_synced_seq: ${String(meta.workspace_last_synced_seq ?? 0)}`,
              `runner_lock_mtime: ${lockMtime || "(none)"}`,
              `runtime_consistency: ${consistencyInfo?.runtimeConsistency || runtimeConsistency}`,
              `runtime_signature: ${runtimeSignature || "(none)"}`,
              `runtime_expected_signature: ${runtimeSignatureExpected || "(none)"}`,
              `external_runner_running: ${externalRunner.running ? "true" : "false"}`,
              `external_runner_pid: ${externalRunner.pid > 0 ? String(externalRunner.pid) : "(none)"}`,
              `external_runner_last_tick_at: ${externalRunner.lastTickAt || "(none)"}`,
              `external_runner_last_exit_code: ${externalRunner.lastExitCode || "(none)"}`,
              runnerStatus === "degraded" && cfg.runnerFallbackEnabled
                ? "runner_fallback_hint: bash agent-orchestrator/scripts/orchestrate_runner_daemon.sh start 10"
                : "runner_fallback_hint: (none)",
              `amendments: ${String(amendmentCount)}`,
              amendmentCount > 0 ? `last_amendment: ${lastAmendment}` : "last_amendment: (none)",
              recent.length > 0 ? "recent_events:" : "recent_events: (none)",
              ...recent.map((line) => `- ${line}`),
            ].join("\n"),
          };
        }

        if (parsed.subcommand === "kb-sync") {
          const normalized = parsed.payload.trim();
          const [taskIdRaw, actionRaw] = normalized.split(/\s+/);
          const taskId = (taskIdRaw || "").trim();
          const action = (actionRaw || "").trim().toLowerCase();
          if (!taskId || !/^[A-Za-z0-9._-]+$/u.test(taskId)) {
            return {
              text: "usage: /orchestrate kb-sync <task_id> [approve|deny|auto-on|auto-off]",
            };
          }
          const taskDir = path.join(paths.taskFoldersRoot, taskId);
          const metaPath = path.join(taskDir, "meta.json");
          if (!(await fileExists(metaPath))) {
            return { text: `task not found: ${taskId}` };
          }
          const runtime = await readJsonOrDefault<Record<string, unknown>>(
            paths.executionRuntime,
            {},
          );
          const kbImport =
            runtime.kb_import &&
            typeof runtime.kb_import === "object" &&
            !Array.isArray(runtime.kb_import)
              ? (runtime.kb_import as Record<string, unknown>)
              : {};
          const confirmRequired = asBoolean(kbImport.confirm_required, true);
          const autoEnabled = asBoolean(kbImport.auto_enabled, false);
          const maxFiles = asPositiveInt(kbImport.max_files_per_batch, 20);
          const maxBytes = asPositiveInt(kbImport.max_bytes_per_batch, 10 * 1024 * 1024);

          const meta = await readJsonOrDefault<Record<string, unknown>>(metaPath, {});
          const projectId = String(meta.project_id ?? "prj_default");
          const runRoot = String(
            meta.run_root ?? path.join(repoRoot, "projects", projectId, "runs", taskId),
          );
          const requestId = `kbreq_${Date.now()}_${taskId}`;

          if (action === "auto-on" || action === "auto-off") {
            const next = {
              ...runtime,
              kb_import: {
                ...kbImport,
                auto_enabled: action === "auto-on",
              },
            };
            await writeJsonAtomic(paths.executionRuntime, next);
            await emitEvent("orchestrate.kb_import.requested", {
              task_id: taskId,
              request_id: requestId,
              action,
              updated_auto_enabled: action === "auto-on",
            });
            return {
              text: `kb_import_auto_enabled: ${action === "auto-on" ? "true" : "false"}`,
            };
          }

          const preview = await runWhitelistedScript({
            repoRoot,
            scriptName: "kb_import_from_workspace",
            args: [
              "--task-id",
              taskId,
              "--run-root",
              runRoot,
              "--max-files",
              String(maxFiles),
              "--max-bytes",
              String(maxBytes),
              "--preview",
            ],
            timeoutMs: 30_000,
            maxBufferBytes: 1024 * 1024,
          });
          const previewJson = JSON.parse(preview.stdout || "{}") as Record<string, unknown>;
          const fileCount = asPositiveInt(previewJson.file_count, 0);
          const totalBytes = asPositiveInt(previewJson.total_bytes, 0);
          const topFiles = Array.isArray(previewJson.files)
            ? (previewJson.files as Array<Record<string, unknown>>).slice(0, 5)
            : [];

          if (action === "deny") {
            const now = new Date().toISOString();
            const nextMeta = {
              ...meta,
              kb_import: {
                ...(meta.kb_import && typeof meta.kb_import === "object"
                  ? (meta.kb_import as Record<string, unknown>)
                  : {}),
                last_request_id: requestId,
                last_decision: "DENY",
                last_decision_at: now,
              },
            };
            await writeJsonAtomic(metaPath, nextMeta);
            await emitEvent("orchestrate.kb_import.denied", {
              task_id: taskId,
              request_id: requestId,
              file_count: fileCount,
              total_bytes: totalBytes,
            });
            return { text: `kb-sync denied: task_id=${taskId}` };
          }

          const shouldAsk = confirmRequired && !autoEnabled && action !== "approve";
          if (shouldAsk) {
            await emitEvent("orchestrate.kb_import.requested", {
              task_id: taskId,
              request_id: requestId,
              file_count: fileCount,
              total_bytes: totalBytes,
              run_root: runRoot,
            });
            return {
              text: [
                `task_id: ${taskId}`,
                `kb_import_confirm_required: true`,
                `candidate_files: ${String(fileCount)}`,
                `candidate_bytes: ${String(totalBytes)}`,
                "top_files:",
                ...topFiles.map(
                  (row) => `- ${String(row.path ?? "unknown")} (${String(row.size ?? 0)} bytes)`,
                ),
                "",
                "是否允许本次导入？",
                `允许: /orchestrate kb-sync ${taskId} approve`,
                `拒绝: /orchestrate kb-sync ${taskId} deny`,
              ].join("\n"),
            };
          }

          const imported = await runWhitelistedScript({
            repoRoot,
            scriptName: "kb_import_from_workspace",
            args: [
              "--task-id",
              taskId,
              "--run-root",
              runRoot,
              "--max-files",
              String(maxFiles),
              "--max-bytes",
              String(maxBytes),
            ],
            timeoutMs: 30_000,
            maxBufferBytes: 1024 * 1024,
          });
          const importedJson = JSON.parse(imported.stdout || "{}") as Record<string, unknown>;
          const now = new Date().toISOString();
          const nextMeta = {
            ...meta,
            kb_import: {
              ...(meta.kb_import && typeof meta.kb_import === "object"
                ? (meta.kb_import as Record<string, unknown>)
                : {}),
              last_request_id: requestId,
              last_decision: "ALLOW",
              last_decision_at: now,
            },
          };
          await writeJsonAtomic(metaPath, nextMeta);
          await emitEvent("orchestrate.kb_import.approved", {
            task_id: taskId,
            request_id: requestId,
            file_count: asPositiveInt(importedJson.file_count, fileCount),
            total_bytes: asPositiveInt(importedJson.total_bytes, totalBytes),
            pending_file: String(importedJson.pending_file ?? ""),
          });
          return {
            text: [
              `task_id: ${taskId}`,
              `kb-sync: approved`,
              `pending_file: ${String(importedJson.pending_file ?? "(none)")}`,
              `file_count: ${String(importedJson.file_count ?? fileCount)}`,
              `total_bytes: ${String(importedJson.total_bytes ?? totalBytes)}`,
            ].join("\n"),
          };
        }

        if (parsed.subcommand === "intake") {
          const freeText = parsed.payload.trim();
          if (!freeText) {
            return { text: `missing request text\n\n${renderOrchestrateHelp()}` };
          }
          const sessionKey = resolveConversationSessionKey(ctx) || "legacy_intake";
          const existing =
            (await readOrchestrateSession(sessionKey)) ??
            buildEmptyOrchestrateSession({
              sessionKey,
              channel: ctx.channel,
              senderId: ctx.senderId ?? "unknown",
            });
          const next = applyMessageToDraft(existing, freeText);
          await writeOrchestrateSession(next);
          await emitEvent("orchestrate.intake.created", {
            session_key: sessionKey,
            compatibility: "legacy_intake_redirected_to_session",
          });
          return {
            text: [
              "intake is now a legacy helper",
              "content was added into the current orchestrate session draft",
              "",
              renderSessionSummary(next),
              "",
              "recommended next steps:",
              "1. continue chatting in this session",
              "2. run /orchestrate summary",
              "3. run /orchestrate run",
            ].join("\n"),
          };
        }

        if (parsed.subcommand === "amend") {
          const normalized = parsed.payload.trim();
          const [taskId, ...rest] = normalized.split(/\s+/);
          const amendment = rest.join(" ").trim();
          if (!taskId || !/^[A-Za-z0-9._-]+$/u.test(taskId) || !amendment) {
            return { text: `usage: /orchestrate amend <task_id> <extra requirement>` };
          }
          const taskDir = path.join(paths.taskFoldersRoot, taskId);
          const metaPath = path.join(taskDir, "meta.json");
          if (!(await fileExists(metaPath))) {
            return { text: `task not found: ${taskId}` };
          }
          const amendPath = path.join(taskDir, "amendments.md");
          const line = `- ${new Date().toISOString()} ${amendment}`;
          if (await fileExists(amendPath)) {
            const current = await readText(amendPath);
            await writeTextAtomic(amendPath, `${current.trimEnd()}\n${line}\n`);
          } else {
            await writeTextAtomic(amendPath, `# Amendments\n\n${line}\n`);
          }
          try {
            await runWhitelistedScript({
              repoRoot,
              scriptName: "append_task_event",
              args: [
                path.relative(repoRoot, taskDir),
                "planner-core",
                `op_amend_${Date.now()}`,
                "REQUIREMENT_AMENDED",
                amendment.replace(/\s+/g, "_"),
              ],
            });
          } catch {
            // Non-blocking: amendment must still be persisted even if event script fails.
          }
          await emitEvent("orchestrate.task.amended", {
            task_id: taskId,
            amendment,
            amendment_path: amendPath,
          });
          return {
            text: [
              `task_id: ${taskId}`,
              "amendment accepted",
              `amendment: ${amendment}`,
              "next: run /orchestrate status <task_id> to track progress",
            ].join("\n"),
          };
        }

        if (parsed.subcommand === "run") {
          const runPayloadError = validateRunCommandPayload(parsed.payload);
          if (runPayloadError) {
            return { text: runPayloadError };
          }
          const sessionKeyForRun = resolveConversationSessionKey(ctx);
          if (!sessionKeyForRun) {
            return { text: "orchestrate run failed: missing session key" };
          }
          const session = await readOrchestrateSession(sessionKeyForRun);
          const runnableSummary = getRunnableSummary(session);
          if (!runnableSummary.ok) {
            return { text: runnableSummary.error };
          }
          const activeSession = session as OrchestrateSessionState;
          const latestSummary = runnableSummary.summary;

          const requestedMode = latestSummary.content.requested_mode;
          const taskId = buildTaskId(latestSummary.content.task_goal);

          const runtimeStatsForWorkspace = await loadExecutionRuntime();
          let workspaceResolved: {
            projectId: string;
            workspaceRoot: string;
            source: WorkspaceConfigSource;
            validated: boolean;
          };
          try {
            workspaceResolved = await resolveWorkspaceConfigForRun({
              runtimeStats: runtimeStatsForWorkspace,
              projectIdFromFlag: latestSummary.content.project_id,
              workspaceRootFromFlag: latestSummary.content.workspace_root,
              taskId,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { text: `orchestrate run failed: ${message}` };
          }

          const strategyInitial = buildStrategyFromSummary({
            summary: latestSummary.content,
            taskId,
            channel: ctx.channel,
            senderId: ctx.senderId,
            sessionKey: sessionKeyForRun,
            messageThreadId: ctx.messageThreadId,
            workspace: {
              project_id: workspaceResolved.projectId,
              workspace_root: workspaceResolved.workspaceRoot,
              source: workspaceResolved.source,
            },
          });

          const operationId = buildOperationId({
            subcommand: "run",
            sessionKey: sessionKeyForRun,
            messageThreadId: ctx.messageThreadId,
            request: strategyInitial.raw_request,
          });
          const llmPlan = {
            strategy: strategyInitial,
            used: false,
            reason: "session_summary",
            authMode: "auto" as const,
            keySource: "",
          };
          const strategy = llmPlan.strategy;
          const strategyPath = path.join(paths.orchestrateRequestsDir, `${taskId}.strategy.json`);
          await writeJsonAtomic(strategyPath, strategy);
          const summaryPath = buildSummaryFilePath(
            paths.orchestrateRequestsDir,
            sessionKeyForRun,
            latestSummary.summary_id,
          );
          const taskDir = path.join(paths.taskFoldersRoot, taskId);
          const taskDirArg = path.relative(repoRoot, taskDir);
          const strategyPathArg = path.relative(repoRoot, strategyPath);
          const scriptTrace: string[] = [];
          const singleWorkerId = buildWorkerIdFromTaskId(taskId);

          try {
            const created = await runWhitelistedScript({
              repoRoot,
              scriptName: "create_task_from_strategy",
              args: [strategyPathArg],
            });
            scriptTrace.push(
              `create_task_from_strategy: ${trimOutput(created.stdout || created.stderr || "ok")}`,
            );

            const createdMetaPath = path.join(taskDir, "meta.json");
            const createdMeta = await readJsonOrDefault<Record<string, unknown>>(
              createdMetaPath,
              {},
            );
            await writeJsonAtomic(createdMetaPath, {
              ...createdMeta,
              requested_mode: requestedMode,
              orchestrate_session_key: sessionKeyForRun,
              summary_id: latestSummary.summary_id,
              summary_path: summaryPath,
              input_source: "session_summary",
            });
            await writeJsonAtomic(strategyPath, {
              ...strategy,
              status: "drafted",
              summary_id: latestSummary.summary_id,
              summary_path: summaryPath,
              input_source: "session_summary",
            });

            await writeOrchestrateSession({
              ...activeSession,
              status: "RUNNING",
              updated_at: new Date().toISOString(),
              latest_summary: {
                ...latestSummary,
                status: "consumed",
              },
              last_run: {
                task_id: taskId,
                started_at: new Date().toISOString(),
                summary_id: latestSummary.summary_id,
              },
            });
            await emitEvent("orchestrate.session.run_started", {
              session_key: sessionKeyForRun,
              summary_id: latestSummary.summary_id,
              summary_path: summaryPath,
              task_id: taskId,
            });

            const planned = await runWhitelistedScript({
              repoRoot,
              scriptName: "planner_entry",
              args: ["--task-dir", taskDirArg, "--requested-mode", requestedMode],
            });
            scriptTrace.push(
              `planner_entry: ${trimOutput(planned.stdout || planned.stderr || "ok")}`,
            );

            const planningActor = "planner-core";
            const transitions: Array<{ from: string; to: string; reason: string }> = [
              { from: "CREATED", to: "PLANNED", reason: "orchestrate-run planned" },
              { from: "PLANNED", to: "ASSIGNED", reason: "orchestrate-run assigned" },
            ];
            for (const t of transitions) {
              const transition = await runWhitelistedScript({
                repoRoot,
                scriptName: "transition_task_state",
                args: [
                  taskDirArg,
                  planningActor,
                  `${operationId}:${t.from.toLowerCase()}-${t.to.toLowerCase()}`,
                  t.from,
                  t.to,
                  t.reason.replace(/\s+/g, "_"),
                ],
              });
              scriptTrace.push(
                `transition_task_state ${t.from}->${t.to}: ${trimOutput(
                  transition.stdout || transition.stderr || "ok",
                )}`,
              );
            }

            const dashboard = await runWhitelistedScript({
              repoRoot,
              scriptName: "dashboard_summary",
              args: [],
            });
            scriptTrace.push(
              `dashboard_summary: ${trimOutput(dashboard.stdout || dashboard.stderr || "ok")}`,
            );

            await writeJsonAtomic(strategyPath, {
              ...strategy,
              status: "applied",
              summary_id: latestSummary.summary_id,
              summary_path: summaryPath,
              input_source: "session_summary",
            });
            const meta = await readJsonOrDefault<Record<string, unknown>>(
              path.join(taskDir, "meta.json"),
              {},
            );
            const runnerInfo = await ensureRunnerStarted();
            const [runtimeStats, externalRunner] = await Promise.all([
              loadExecutionRuntime(),
              getExternalRunnerStatus(),
            ]);
            const splitUnitsPlanned = asPositiveInt(
              (meta as Record<string, unknown>).split_units_planned,
              1,
            );
            const requestedModeResolved = String(meta.requested_mode ?? requestedMode);
            const resolvedMode = String(
              meta.execution_mode ??
                (Array.isArray(meta.children) && meta.children.length > 0 ? "multi" : "single"),
            );
            const planningDecision =
              meta.planning_decision &&
              typeof meta.planning_decision === "object" &&
              !Array.isArray(meta.planning_decision)
                ? (meta.planning_decision as Record<string, unknown>)
                : {};
            const aggregate =
              meta.aggregate && typeof meta.aggregate === "object" && !Array.isArray(meta.aggregate)
                ? (meta.aggregate as Record<string, unknown>)
                : {};
            const executionRoles =
              meta.execution_roles &&
              typeof meta.execution_roles === "object" &&
              !Array.isArray(meta.execution_roles)
                ? (meta.execution_roles as Record<string, unknown>)
                : {};
            const payload = {
              task_id: taskId,
              orchestrate_session_key: sessionKeyForRun,
              summary_id: latestSummary.summary_id,
              summary_path: summaryPath,
              operation_id: operationId,
              state: String(meta.state ?? "UNKNOWN"),
              version: Number(meta.version ?? 0),
              strategy_path: strategyPath,
              dashboard_path: basePath,
              scheduler_status: runnerInfo.schedulerStatus,
              last_tick_at: runnerInfo.lastTickAt,
              last_tick_result: runnerLastTickResult,
              last_tick_error_summary: runnerLastTickError,
              runner_interval_sec: runnerInfo.intervalSec,
              runner_execution_mode: runnerExecutionMode,
              runner_batch_size: runnerBatchSize,
              runner_max_parallel: runnerMaxParallel,
              logical_threads: runtimeStats.logicalThreads,
              effective_worker_threads: runtimeStats.effectiveWorkerThreads,
              requested_mode: requestedModeResolved,
              resolved_mode: resolvedMode,
              decision_source: String(planningDecision.decision_source ?? "manual_override"),
              decision_reason: String(planningDecision.decision_reason ?? ""),
              split_units_planned: splitUnitsPlanned,
              parallel_limit: runtimeStats.parallelLimit,
              queue_depth: runtimeStats.queueDepth,
              policy_mode: runtimeStats.policyMode,
              role_policy_version: String(meta.role_constraints_version ?? "unknown"),
              work_domain_id: String(meta.work_domain_id ?? "(none)"),
              workspace_root: String(meta.workspace_root ?? runtimeStats.workdomainRoot),
              workspace_config_source: String(
                meta.workspace_config_source ?? workspaceResolved.source,
              ),
              workspace_validated: Boolean(
                (meta.workspace_validated as boolean | undefined) ?? workspaceResolved.validated,
              ),
              planning_actor: String(executionRoles.planning_actor ?? "planner-core"),
              scheduling_actor: String(executionRoles.scheduling_actor ?? "scheduler-ops"),
              actor_compat_mode: Boolean(executionRoles.compat_mode ?? false),
              actor_compat_hits: Number(executionRoles.compat_hits ?? 0),
              aggregate_publish_status: String(aggregate.publish_status ?? "none"),
              aggregate_manifest: String(aggregate.manifest_path ?? ""),
              aggregate_audit_status: String(
                (meta as Record<string, unknown>).aggregate_audit_status ??
                  (aggregate.publish_status === "audited_pass" ||
                  aggregate.publish_status === "published"
                    ? "PASS"
                    : aggregate.publish_status === "audited_fail" ||
                        aggregate.publish_status === "rolled_back"
                      ? "FAIL"
                      : ""),
              ),
              aggregate_collisions_count: Number(
                (meta as Record<string, unknown>).aggregate_collisions_count ?? 0,
              ),
              aggregate_last_block_reason: String(aggregate.last_block_reason ?? ""),
              acl_denied_count: Number(
                (meta.acl as Record<string, unknown> | undefined)?.denied_count ??
                  runtimeStats.aclDeniedCount,
              ),
              acl_last_denied_at: String(
                (meta.acl as Record<string, unknown> | undefined)?.last_denied_at ??
                  runtimeStats.aclLastDeniedAt,
              ),
              sandbox_status: runtimeStats.sandboxEnabled ? "enabled" : "disabled",
              commit_guard_status: runtimeStats.commitGuardEnabled ? "enabled" : "disabled",
              kb_import_confirm_required: runtimeStats.kbImportConfirmRequired,
              kb_import_auto_enabled: runtimeStats.kbImportAutoEnabled,
              workspace_sync_sensitivity: runtimeStats.workspaceSyncSensitivity,
              skill_mcp_isolation_enabled: runtimeStats.skillMcpIsolationEnabled,
              protect_orchestrator_config: runtimeStats.protectOrchestratorConfig,
              project_runtime_profile: runtimeStats.projectRuntimeProfile,
              orchestrator_runtime_profile: runtimeStats.orchestratorRuntimeProfile,
              workspace_user_change_seq: Number(meta.workspace_user_change_seq ?? 0),
              workspace_last_synced_seq: Number(meta.workspace_last_synced_seq ?? 0),
              project_id: String(meta.project_id ?? "prj_default"),
              run_root: String(meta.run_root ?? "(none)"),
              runtime_consistency: consistencyInfo?.runtimeConsistency || runtimeConsistency,
              runtime_signature: runtimeSignature || "",
              runtime_expected_signature: runtimeSignatureExpected || "",
              external_runner_running: externalRunner.running,
              external_runner_pid: externalRunner.pid,
              external_runner_last_tick_at: externalRunner.lastTickAt,
              external_runner_last_exit_code: externalRunner.lastExitCode,
              llm_used: llmPlan.used,
              llm_reason: llmPlan.reason,
              llm_auth_mode: llmPlan.authMode,
              llm_key_source: llmPlan.keySource || "",
            };
            await emitEvent("orchestrate.run.applied", payload);
            if (payload.work_domain_id && payload.work_domain_id !== "(none)") {
              await emitEvent("orchestrate.workdomain.allocated", {
                task_id: taskId,
                work_domain_id: payload.work_domain_id,
                workspace_root: payload.workspace_root,
                role_policy_version: payload.role_policy_version,
              });
              await emitEvent("orchestrate.workdomain.sync_completed", {
                task_id: taskId,
                work_domain_id: payload.work_domain_id,
                sync_strategy: "copy_on_submit",
              });
            }

            return {
              text: [
                `task_id: ${taskId}`,
                `orchestrate_session_key: ${sessionKeyForRun}`,
                `summary_id: ${latestSummary.summary_id}`,
                `summary_path: ${summaryPath}`,
                `state: ${payload.state}`,
                `version: ${String(payload.version)}`,
                `worker: ${singleWorkerId}`,
                `strategy: ${strategyPath}`,
                `dashboard: ${basePath}`,
                `scheduler_status: ${runnerInfo.schedulerStatus}`,
                `last_tick_at: ${runnerInfo.lastTickAt || "(pending)"}`,
                `last_tick_result: ${runnerLastTickResult}${runnerLastTickError ? ` (${runnerLastTickError})` : ""}`,
                `runner_interval_sec: ${String(runnerInfo.intervalSec)}`,
                `runner_execution_mode: ${runnerExecutionMode}`,
                `runner_batch_size: ${String(runnerBatchSize)}`,
                `runner_max_parallel: ${String(runnerMaxParallel)}`,
                `logical_threads: ${String(runtimeStats.logicalThreads)}`,
                `effective_worker_threads: ${String(runtimeStats.effectiveWorkerThreads)}`,
                `requested_mode: ${requestedModeResolved}`,
                `resolved_mode: ${resolvedMode}`,
                `decision_source: ${String(planningDecision.decision_source ?? "manual_override")}`,
                `decision_reason: ${String(planningDecision.decision_reason ?? "(none)")}`,
                `split_units_planned: ${String(splitUnitsPlanned)}`,
                `parallel_limit: ${String(runtimeStats.parallelLimit)}`,
                `queue_depth: ${String(runtimeStats.queueDepth)}`,
                `policy_mode: ${runtimeStats.policyMode}`,
                `role_policy_version: ${String(meta.role_constraints_version ?? "unknown")}`,
                `work_domain_id: ${String(meta.work_domain_id ?? "(none)")}`,
                `workspace_root: ${String(meta.workspace_root ?? runtimeStats.workdomainRoot)}`,
                `workspace_config_source: ${String(meta.workspace_config_source ?? workspaceResolved.source)}`,
                `workspace_validated: ${String(((meta.workspace_validated as boolean | undefined) ?? workspaceResolved.validated) ? "true" : "false")}`,
                `planning_actor: ${String(payload.planning_actor)}`,
                `scheduling_actor: ${String(payload.scheduling_actor)}`,
                `actor_compat_mode: ${String(payload.actor_compat_mode ? "true" : "false")}`,
                `actor_compat_hits: ${String(payload.actor_compat_hits)}`,
                `aggregate_publish_status: ${String(aggregate.publish_status ?? "none")}`,
                `aggregate_manifest: ${String(aggregate.manifest_path ?? "(none)")}`,
                `aggregate_audit_status: ${String(payload.aggregate_audit_status || "(none)")}`,
                `aggregate_collisions_count: ${String(payload.aggregate_collisions_count)}`,
                `aggregate_last_block_reason: ${String(aggregate.last_block_reason ?? "(none)")}`,
                `run_root: ${String(meta.run_root ?? "(none)")}`,
                `project_id: ${String(meta.project_id ?? "prj_default")}`,
                `runtime_consistency: ${consistencyInfo?.runtimeConsistency || runtimeConsistency}`,
                `runtime_signature: ${runtimeSignature || "(none)"}`,
                `runtime_expected_signature: ${runtimeSignatureExpected || "(none)"}`,
                `external_runner_running: ${externalRunner.running ? "true" : "false"}`,
                `external_runner_pid: ${externalRunner.pid > 0 ? String(externalRunner.pid) : "(none)"}`,
                `external_runner_last_tick_at: ${externalRunner.lastTickAt || "(none)"}`,
                `external_runner_last_exit_code: ${externalRunner.lastExitCode || "(none)"}`,
                runnerInfo.schedulerStatus === "degraded" && cfg.runnerFallbackEnabled
                  ? "runner_fallback_hint: bash agent-orchestrator/scripts/orchestrate_runner_daemon.sh start 10"
                  : "runner_fallback_hint: (none)",
                `acl_denied_count: ${String((meta.acl as Record<string, unknown> | undefined)?.denied_count ?? runtimeStats.aclDeniedCount)}`,
                `acl_last_denied_at: ${String(((meta.acl as Record<string, unknown> | undefined)?.last_denied_at ?? runtimeStats.aclLastDeniedAt) || "(none)")}`,
                `sandbox_status: ${runtimeStats.sandboxEnabled ? "enabled" : "disabled"}`,
                `commit_guard_status: ${runtimeStats.commitGuardEnabled ? "enabled" : "disabled"}`,
                `kb_import_confirm_required: ${runtimeStats.kbImportConfirmRequired ? "true" : "false"}`,
                `kb_import_auto_enabled: ${runtimeStats.kbImportAutoEnabled ? "true" : "false"}`,
                `workspace_sync_sensitivity: ${runtimeStats.workspaceSyncSensitivity}`,
                `skill_mcp_isolation_enabled: ${runtimeStats.skillMcpIsolationEnabled ? "true" : "false"}`,
                `protect_orchestrator_config: ${runtimeStats.protectOrchestratorConfig ? "true" : "false"}`,
                `project_runtime_profile: ${runtimeStats.projectRuntimeProfile}`,
                `orchestrator_runtime_profile: ${runtimeStats.orchestratorRuntimeProfile}`,
                `workspace_user_change_seq: ${String(meta.workspace_user_change_seq ?? 0)}`,
                `workspace_last_synced_seq: ${String(meta.workspace_last_synced_seq ?? 0)}`,
                `llm_planner: ${llmPlan.used ? "enabled" : `fallback(${llmPlan.reason})`}`,
                `llm_auth_mode: ${llmPlan.authMode}`,
                `llm_key_source: ${llmPlan.keySource || "(none)"}`,
                "",
                renderRequiredConfigChecklist(),
                "",
                ...scriptTrace,
              ].join("\n"),
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await emitEvent("orchestrate.run.failed", {
              task_id: taskId,
              operation_id: operationId,
              error: message,
            });
            return {
              text: `orchestrate run failed: ${message}\nstrategy: ${strategyPath}`,
            };
          }
        }

        return { text: renderOrchestrateHelp() };
      },
    });

    api.registerHttpRoute({
      path: basePath,
      handler: async (_req, res) => {
        sendHtml(
          res,
          200,
          renderDashboardHtml({
            apiBasePath,
            title: "OpenClaw Orchestrator Dashboard",
          }),
        );
      },
    });

    api.registerHttpRoute({
      path: `${basePath}/`,
      handler: async (_req, res) => {
        sendHtml(
          res,
          200,
          renderDashboardHtml({
            apiBasePath,
            title: "OpenClaw Orchestrator Dashboard",
          }),
        );
      },
    });

    api.registerHttpHandler(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!url.pathname.startsWith(apiBasePath)) {
        return false;
      }

      if (!isAuthorized(req, api, cfg)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return true;
      }

      const subPath = url.pathname.slice(apiBasePath.length) || "/";

      try {
        if (req.method === "GET" && subPath === "/overview") {
          const [dashboard, systemHealth] = await Promise.all([
            readJsonOrDefault(paths.dashboardJson, {}),
            readJsonOrDefault(paths.systemHealthJson, {}),
          ]);
          sendJson(res, 200, {
            pluginId: "orchestrator-dashboard",
            generatedAt: new Date().toISOString(),
            dashboard,
            systemHealth,
          });
          return true;
        }

        if (req.method === "GET" && subPath === "/configs/current") {
          sendJson(res, 200, await loadCurrentConfig());
          return true;
        }

        if (req.method === "POST" && subPath === "/configs/validate") {
          const body = await parseJsonBody(req);
          const draft = body.draft;
          const result = await validateDraft(draft);
          await emitEvent("config.draft.validated", result, req);
          sendJson(res, 200, result);
          return true;
        }

        if (req.method === "POST" && subPath === "/configs/commit") {
          const lockOk = await acquireLock();
          if (!lockOk) {
            sendJson(res, 409, { error: "config transaction in progress" });
            return true;
          }

          try {
            const body = await parseJsonBody(req);
            const draft =
              body.draft && typeof body.draft === "object" && !Array.isArray(body.draft)
                ? (body.draft as Record<string, unknown>)
                : {};
            const reason =
              typeof body.reason === "string" ? body.reason.trim() : "commit from openclaw plugin";
            const approvalId = typeof body.approvalId === "string" ? body.approvalId.trim() : "";

            const validation = await validateDraft(draft);
            if (!validation.valid) {
              sendJson(res, 400, { error: "draft validation failed", validation });
              return true;
            }
            if (validation.requiresApproval && !approvalId) {
              sendJson(res, 403, { error: "approvalId required for HIGH/CRITICAL changes" });
              return true;
            }

            const plannerCurrent =
              draft.plannerCurrent &&
              typeof draft.plannerCurrent === "object" &&
              !Array.isArray(draft.plannerCurrent)
                ? (draft.plannerCurrent as Record<string, unknown>)
                : {};
            const plannerProperties =
              draft.plannerProperties &&
              typeof draft.plannerProperties === "object" &&
              !Array.isArray(draft.plannerProperties)
                ? (draft.plannerProperties as Record<string, unknown>)
                : {};
            const auditPolicy =
              draft.auditPolicy &&
              typeof draft.auditPolicy === "object" &&
              !Array.isArray(draft.auditPolicy)
                ? (draft.auditPolicy as Record<string, unknown>)
                : {};

            const [currentRaw, propsRaw] = await Promise.all([
              readText(paths.plannerCurrent),
              readText(paths.plannerProperties),
            ]);
            await writeTextAtomic(
              paths.plannerCurrent,
              updatePlainKvText(currentRaw, plannerCurrent),
            );
            await writeTextAtomic(
              paths.plannerProperties,
              updateListKvText(propsRaw, plannerProperties),
            );
            await writeJsonAtomic(paths.auditPolicy, auditPolicy);

            const snapshotVersion = `openclaw-orch-${new Date()
              .toISOString()
              .replace(/[-:TZ.]/g, "")
              .slice(0, 14)}-${randomUUID().slice(0, 6)}`;

            let snapshotOut = "";
            if (await fileExists(paths.snapshotScript)) {
              const scriptRes = await runScript(
                paths.snapshotScript,
                [snapshotVersion, "openclaw", reason],
                repoRoot,
              );
              snapshotOut = scriptRes.stdout || scriptRes.stderr;
            }

            const payload = {
              committed: true,
              snapshotVersion,
              riskLevel: validation.riskLevel,
              changedKeys: validation.changedKeys,
              approvalId,
              scriptOutput: snapshotOut,
            };
            await emitEvent("config.committed", payload, req);
            sendJson(res, 200, payload);
            return true;
          } finally {
            await releaseLock();
          }
        }

        if (req.method === "POST" && subPath === "/configs/rollback") {
          const body = await parseJsonBody(req);
          const targetVersionId =
            typeof body.targetVersionId === "string" ? body.targetVersionId.trim() : "";
          const reason =
            typeof body.reason === "string" ? body.reason.trim() : "rollback from openclaw plugin";

          if (!targetVersionId) {
            sendJson(res, 400, { error: "targetVersionId is required" });
            return true;
          }
          if (!(await fileExists(paths.rollbackScript))) {
            sendJson(res, 500, { error: "rollback script not found", path: paths.rollbackScript });
            return true;
          }

          const rollbackRes = await runScript(
            paths.rollbackScript,
            [targetVersionId, "openclaw", reason],
            repoRoot,
          );
          const payload = {
            rolledBack: true,
            targetVersionId,
            output: rollbackRes.stdout || rollbackRes.stderr,
          };
          await emitEvent("config.rollback.executed", payload, req);
          sendJson(res, 200, payload);
          return true;
        }

        if (req.method === "GET" && subPath === "/configs/history") {
          sendJson(res, 200, { items: await readNdjson(paths.history) });
          return true;
        }

        if (req.method === "GET" && subPath === "/events") {
          const limitRaw = Number.parseInt(url.searchParams.get("limit") || "200", 10);
          const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 200;
          const rows = await readNdjson(eventsPath);
          sendJson(res, 200, { items: rows.slice(-limit) });
          return true;
        }

        if (req.method === "GET" && subPath === "/meta") {
          sendJson(res, 200, {
            pluginId: "orchestrator-dashboard",
            basePath,
            apiBasePath,
            repoRoot,
            paths,
          });
          return true;
        }

        sendJson(res, 404, { error: "not found", path: subPath });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await emitEvent("runtime.error", { error: message, path: subPath }, req);
        sendJson(res, 500, { error: message });
        return true;
      }
    });

    api.registerGatewayMethod("orchestrator.overview", async ({ respond }) => {
      try {
        const [dashboard, systemHealth] = await Promise.all([
          readJsonOrDefault(paths.dashboardJson, {}),
          readJsonOrDefault(paths.systemHealthJson, {}),
        ]);
        respond(true, {
          dashboard,
          systemHealth,
          plugin: "orchestrator-dashboard",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        respond(false, { error: message });
      }
    });

    api.logger.info(
      `orchestrator-dashboard: mounted ui=${basePath} api=${apiBasePath} repoRoot=${repoRoot}`,
    );
  },
};

export default orchestratorDashboardPlugin;
