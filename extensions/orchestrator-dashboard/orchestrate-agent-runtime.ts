import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { OrchestrateStrategy } from "./orchestrate-command.js";
import {
  type PlannerAgentPolicy,
  type PlannerPolicyDocument,
} from "./orchestrate-planner-contract.js";
import { loadPlannerPolicyDocument } from "./orchestrate-planner-policy.js";

export type AgentRuntimeConfig = {
  plannerPolicy: PlannerPolicyDocument;
  plannerAgent: PlannerAgentPolicy;
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

export type AgentRuntimeController = {
  loadAgentRuntimeConfig: () => Promise<AgentRuntimeConfig>;
  enhanceStrategyWithLlm: (params: {
    strategy: OrchestrateStrategy;
    freeText: string;
    operationId: string;
  }) => Promise<{
    strategy: OrchestrateStrategy;
    used: boolean;
    reason: string;
    authMode: "auto" | "standalone" | "openclaw";
    keySource: string;
  }>;
};

export type BuildAgentRuntimeControllerParams = {
  api: Pick<OpenClawPluginApi, "config">;
  paths: {
    agentRuntimeConfig: string;
    plannerPolicyConfig?: string;
  };
  io: {
    readJsonOrDefault: <T>(targetPath: string, fallback: T) => Promise<T>;
  };
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
  trimOutput: (value: string, maxChars?: number) => string;
};

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

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeResponseJson(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("```")) {
    const stripped = trimmed.replace(/^```[a-zA-Z]*\n?/u, "").replace(/\n?```$/u, "");
    return stripped.trim();
  }
  return trimmed;
}

export function buildAgentRuntimeController(
  params: BuildAgentRuntimeControllerParams,
): AgentRuntimeController {
  const loadAgentRuntimeConfig = async (): Promise<AgentRuntimeConfig> => {
    const defaults: AgentRuntimeConfig = {
      plannerPolicy: await loadPlannerPolicyDocument({
        io: {
          readJsonOrDefault: params.io.readJsonOrDefault,
        },
        paths: {
          plannerPolicyConfig:
            params.paths.plannerPolicyConfig ??
            params.paths.agentRuntimeConfig.replace(/agent_runtime\.json$/u, "planner_policy.json"),
          agentRuntimeConfig: params.paths.agentRuntimeConfig,
        },
      }),
      plannerAgent: {} as PlannerAgentPolicy,
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
    defaults.plannerAgent = defaults.plannerPolicy.planner_agent;
    const localRuntimePath = params.paths.agentRuntimeConfig.replace(/\.json$/u, ".local.json");
    const [fromFile, fromLocal] = await Promise.all([
      params.io.readJsonOrDefault<Record<string, unknown>>(params.paths.agentRuntimeConfig, {}),
      params.io.readJsonOrDefault<Record<string, unknown>>(localRuntimePath, {}),
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
      params.api.config && typeof params.api.config === "object"
        ? (params.api.config as Record<string, unknown>)
        : {};
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
    return {
      plannerPolicy: defaults.plannerPolicy,
      plannerAgent: defaults.plannerPolicy.planner_agent,
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
  };

  const enhanceStrategyWithLlm: AgentRuntimeController["enhanceStrategyWithLlm"] = async (
    request,
  ) => {
    const runtime = await loadAgentRuntimeConfig();
    if (!runtime.llm.enabled) {
      return {
        strategy: request.strategy,
        used: false,
        reason: "llm_disabled",
        authMode: runtime.llm.authMode,
        keySource: runtime.llm.apiKeySource,
      };
    }
    if (!runtime.llm.apiKey) {
      return {
        strategy: request.strategy,
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
                request.freeText,
                "",
                "Current strategy JSON:",
                JSON.stringify(request.strategy),
                "",
                "Return JSON only. Optional keys: title, goal, risk_level, budget.max_token_cost, budget.max_execution_time_seconds.",
              ].join("\n"),
            },
          ],
        }),
      });
      if (!response.ok) {
        const text = params.trimOutput(await response.text(), 500);
        await params.emitEvent("orchestrate.llm.plan_failed", {
          operation_id: request.operationId,
          status: response.status,
          error: text,
        });
        return {
          strategy: request.strategy,
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
        parsedRaw.budget && typeof parsedRaw.budget === "object" && !Array.isArray(parsedRaw.budget)
          ? (parsedRaw.budget as Record<string, unknown>)
          : {};
      const next = {
        ...request.strategy,
        title: asString(parsedRaw.title, request.strategy.title).slice(0, 120),
        goal: asString(parsedRaw.goal, request.strategy.goal).slice(0, 2000),
        risk_level:
          parsedRaw.risk_level === "LOW" ||
          parsedRaw.risk_level === "MEDIUM" ||
          parsedRaw.risk_level === "HIGH"
            ? parsedRaw.risk_level
            : request.strategy.risk_level,
        budget: {
          max_token_cost: asPositiveInt(
            budgetRaw.max_token_cost,
            request.strategy.budget.max_token_cost,
          ),
          max_execution_time_seconds: asPositiveInt(
            budgetRaw.max_execution_time_seconds,
            request.strategy.budget.max_execution_time_seconds,
          ),
        },
      } satisfies OrchestrateStrategy;
      await params.emitEvent("orchestrate.llm.plan_applied", {
        operation_id: request.operationId,
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
      await params.emitEvent("orchestrate.llm.plan_failed", {
        operation_id: request.operationId,
        error: params.trimOutput(message, 500),
      });
      return {
        strategy: request.strategy,
        used: false,
        reason: "llm_exception",
        authMode: runtime.llm.authMode,
        keySource: runtime.llm.apiKeySource,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    loadAgentRuntimeConfig,
    enhanceStrategyWithLlm,
  };
}
