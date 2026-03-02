import type { IncomingMessage } from "node:http";
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
  normalizeFreeTextToStrategy,
  runWhitelistedScript,
} from "./orchestrate-command.js";
import {
  applyMessageToDraft,
  buildEntryAgentContext,
  extractLatestUserMessage,
  parseOrchestrateArgs,
  resolveConversationSessionKey,
  type OrchestrateSessionState,
} from "./orchestrate-session.js";
import { type PathState } from "./orchestrate-path.js";
import { registerOrchestratorHttpRoutes } from "./orchestrate-http.js";
import { createOrchestrateCommandHandlers } from "./orchestrate-command-deps.js";
import {
  readOrchestrateSessionStore,
  readPathStateStore,
  writeOrchestrateSessionStore,
  writePathStateStore,
} from "./orchestrate-state.js";
import {
  createConfigService,
  updateListKvText,
  updatePlainKvText,
} from "./orchestrate-config-service.js";

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
      return readPathStateStore({
        io: { fileExists, readJsonOrDefault, writeJsonAtomic },
        paths,
      });
    };

    const writePathState = async (next: PathState): Promise<void> => {
      await writePathStateStore({
        io: { fileExists, readJsonOrDefault, writeJsonAtomic },
        paths,
        state: next,
      });
    };

    const readOrchestrateSession = async (
      sessionKey: string,
    ): Promise<OrchestrateSessionState | null> => {
      return readOrchestrateSessionStore({
        io: { fileExists, readJsonOrDefault, writeJsonAtomic },
        paths,
        sessionKey,
      });
    };

    const writeOrchestrateSession = async (next: OrchestrateSessionState): Promise<void> => {
      await writeOrchestrateSessionStore({
        io: { fileExists, readJsonOrDefault, writeJsonAtomic },
        paths,
        session: next,
      });
    };

    const configService = createConfigService({
      paths: {
        plannerCurrent: paths.plannerCurrent,
        plannerProperties: paths.plannerProperties,
        auditPolicy: paths.auditPolicy,
      },
      lockPath,
      io: {
        readText,
        readJsonOrDefault,
      },
    });

    const commandHandlers = createOrchestrateCommandHandlers({
      repoRoot,
      basePath,
      cfg: {
        runnerEnabled: cfg.runnerEnabled,
        runnerFallbackEnabled: cfg.runnerFallbackEnabled,
      },
      runnerTimerActive: Boolean(runnerTimer),
      paths: {
        orchestrateRequestsDir: paths.orchestrateRequestsDir,
        taskFoldersRoot: paths.taskFoldersRoot,
        dashboardJson: paths.dashboardJson,
        systemHealthJson: paths.systemHealthJson,
        executionRuntime: paths.executionRuntime,
      },
      readOrchestrateSession,
      writeOrchestrateSession,
      readPathState,
      writePathState,
      statePaths: {
        pathState: paths.pathState,
        orchestrateSessionsDir: paths.orchestrateSessionsDir,
        orchestrateRequestsDir: paths.orchestrateRequestsDir,
      },
      io: {
        fileExists,
        readJsonOrDefault,
        writeJsonAtomic,
        readNdjson,
        readText,
        writeTextAtomic,
      },
      runtime: {
        getRunnerLockMtime,
        loadExecutionRuntime,
        getExternalRunnerStatus,
        ensureRunnerStarted,
        runnerStatus,
        runnerLastTickAt,
        runnerLastTickResult,
        runnerLastTickError,
        runnerIntervalSec,
        runnerExecutionMode,
        runnerBatchSize,
        runnerMaxParallel,
      },
      runWhitelistedScript,
      emitEvent,
      buildWorkerIdFromTaskId,
      trimOutput,
      renderRequiredConfigChecklist,
      renderOrchestrateHelp,
    });

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

        if (
          parsed.subcommand === "start" ||
          parsed.subcommand === "session" ||
          parsed.subcommand === "stop" ||
          parsed.subcommand === "summary"
        ) {
          return {
            text: await commandHandlers.handleSession(parsed.subcommand, ctx),
          };
        }

        if (parsed.subcommand === "path") {
          return {
            text: await commandHandlers.handlePath(parsed.payload, ctx.senderId),
          };
        }

        if (parsed.subcommand === "status") {
          return {
            text: await commandHandlers.handleStatus(parsed.payload, {
              runtimeConsistency: consistencyInfo?.runtimeConsistency || runtimeConsistency,
              runtimeSignature,
              runtimeExpectedSignature: runtimeSignatureExpected,
            }),
          };
        }

        if (parsed.subcommand === "kb-sync") {
          return {
            text: await commandHandlers.handleKbSync(parsed.payload),
          };
        }

        if (parsed.subcommand === "intake") {
          return {
            text: await commandHandlers.handleIntake(parsed.payload, ctx),
          };
        }

        if (parsed.subcommand === "amend") {
          return {
            text: await commandHandlers.handleAmend(parsed.payload),
          };
        }

        if (parsed.subcommand === "run") {
          return {
            text: await commandHandlers.handleRun(parsed.payload, ctx, {
              runtimeConsistency: consistencyInfo?.runtimeConsistency || runtimeConsistency,
              runtimeSignature,
              runtimeExpectedSignature: runtimeSignatureExpected,
            }),
          };
        }

        return { text: renderOrchestrateHelp() };
      },
    });

    registerOrchestratorHttpRoutes({
      api,
      cfg,
      basePath,
      apiBasePath,
      repoRoot,
      paths,
      io: {
        fileExists,
        readJsonOrDefault,
        readText,
        writeTextAtomic,
        writeJsonAtomic,
        readNdjson,
      },
      pathsByName: {
        dashboardJson: paths.dashboardJson,
        systemHealthJson: paths.systemHealthJson,
        plannerCurrent: paths.plannerCurrent,
        plannerProperties: paths.plannerProperties,
        auditPolicy: paths.auditPolicy,
        auditHistory: paths.history,
        snapshotScript: paths.snapshotScript,
        rollbackScript: paths.rollbackScript,
      },
      runtime: {
        eventsPath,
      },
      helpers: {
        loadCurrentConfig: configService.loadCurrentConfig,
        validateDraft: configService.validateDraft,
        acquireLock: configService.acquireLock,
        releaseLock: configService.releaseLock,
        emitEvent,
        runScript,
        updatePlainKvText,
        updateListKvText,
      },
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
