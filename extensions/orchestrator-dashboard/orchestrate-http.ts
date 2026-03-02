import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { handleConfigHttpRequest } from "./orchestrate-config-http.js";

type DashboardPluginConfigLike = {
  requireGatewayAuth: boolean;
};

type HttpPaths = Record<string, string>;

type RegisterOrchestratorHttpParams = {
  api: OpenClawPluginApi;
  cfg: DashboardPluginConfigLike;
  basePath: string;
  apiBasePath: string;
  repoRoot: string;
  paths: HttpPaths;
  io: {
    fileExists: (targetPath: string) => Promise<boolean>;
    readJsonOrDefault: <T>(targetPath: string, fallback: T) => Promise<T>;
    readText: (targetPath: string) => Promise<string>;
    writeTextAtomic: (targetPath: string, payload: string) => Promise<void>;
    writeJsonAtomic: (targetPath: string, payload: unknown) => Promise<void>;
    readNdjson: (targetPath: string) => Promise<Array<Record<string, unknown>>>;
  };
  pathsByName: {
    dashboardJson: string;
    systemHealthJson: string;
    plannerCurrent: string;
    plannerProperties: string;
    auditPolicy: string;
    auditHistory: string;
    snapshotScript: string;
    rollbackScript: string;
  };
  runtime: {
    eventsPath: string;
  };
  helpers: {
    loadCurrentConfig: () => Promise<unknown>;
    validateDraft: (draftInput: unknown) => Promise<{
      valid: boolean;
      requiresApproval: boolean;
      riskLevel: string;
      changedKeys: unknown;
    }>;
    acquireLock: () => Promise<boolean>;
    releaseLock: () => Promise<void>;
    emitEvent: (
      type: string,
      payload: Record<string, unknown>,
      req?: IncomingMessage,
    ) => Promise<void>;
    runScript: (
      scriptPath: string,
      args: string[],
      cwd: string,
    ) => Promise<{ stdout: string; stderr: string }>;
    updatePlainKvText: (source: string, updates: Record<string, unknown>) => string;
    updateListKvText: (source: string, updates: Record<string, unknown>) => string;
  };
};

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
  cfg: DashboardPluginConfigLike,
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

export function registerOrchestratorHttpRoutes(params: RegisterOrchestratorHttpParams): void {
  const { api, cfg, basePath, apiBasePath, repoRoot, paths, io, pathsByName, runtime, helpers } =
    params;

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
          io.readJsonOrDefault(pathsByName.dashboardJson, {}),
          io.readJsonOrDefault(pathsByName.systemHealthJson, {}),
        ]);
        sendJson(res, 200, {
          pluginId: "orchestrator-dashboard",
          generatedAt: new Date().toISOString(),
          dashboard,
          systemHealth,
        });
        return true;
      }

      if (
        await handleConfigHttpRequest({
          req,
          res,
          subPath,
          repoRoot,
          io,
          pathsByName,
          helpers,
          parseJsonBody,
          sendJson,
        })
      ) {
        return true;
      }

      if (req.method === "GET" && subPath === "/events") {
        const limitRaw = Number.parseInt(url.searchParams.get("limit") || "200", 10);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 200;
        const rows = await io.readNdjson(runtime.eventsPath);
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
      await helpers.emitEvent("runtime.error", { error: message, path: subPath }, req);
      sendJson(res, 500, { error: message });
      return true;
    }
  });
}
