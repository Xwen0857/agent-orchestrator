import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

type ConfigHttpPaths = {
  plannerCurrent: string;
  plannerProperties: string;
  auditPolicy: string;
  auditHistory: string;
  snapshotScript: string;
  rollbackScript: string;
};

export async function handleConfigHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  subPath: string;
  repoRoot: string;
  io: {
    fileExists: (targetPath: string) => Promise<boolean>;
    readText: (targetPath: string) => Promise<string>;
    writeTextAtomic: (targetPath: string, payload: string) => Promise<void>;
    writeJsonAtomic: (targetPath: string, payload: unknown) => Promise<void>;
    readNdjson: (targetPath: string) => Promise<Array<Record<string, unknown>>>;
  };
  pathsByName: ConfigHttpPaths;
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
  parseJsonBody: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  sendJson: (res: ServerResponse, statusCode: number, payload: unknown) => void;
}): Promise<boolean> {
  const { req, res, subPath, repoRoot, io, pathsByName, helpers, parseJsonBody, sendJson } = params;

  if (req.method === "GET" && subPath === "/configs/current") {
    sendJson(res, 200, await helpers.loadCurrentConfig());
    return true;
  }

  if (req.method === "POST" && subPath === "/configs/validate") {
    const body = await parseJsonBody(req);
    const result = await helpers.validateDraft(body.draft);
    await helpers.emitEvent("config.draft.validated", result, req);
    sendJson(res, 200, result);
    return true;
  }

  if (req.method === "POST" && subPath === "/configs/commit") {
    const lockOk = await helpers.acquireLock();
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

      const validation = await helpers.validateDraft(draft);
      if (!validation.valid) {
        sendJson(res, 400, { error: "draft validation failed", validation });
        return true;
      }
      if (validation.requiresApproval && !approvalId) {
        sendJson(res, 403, { error: "approvalId required for HIGH/CRITICAL changes" });
        return true;
      }

      const plannerCurrent =
        draft.plannerCurrent && typeof draft.plannerCurrent === "object" && !Array.isArray(draft.plannerCurrent)
          ? (draft.plannerCurrent as Record<string, unknown>)
          : {};
      const plannerProperties =
        draft.plannerProperties &&
        typeof draft.plannerProperties === "object" &&
        !Array.isArray(draft.plannerProperties)
          ? (draft.plannerProperties as Record<string, unknown>)
          : {};
      const auditPolicy =
        draft.auditPolicy && typeof draft.auditPolicy === "object" && !Array.isArray(draft.auditPolicy)
          ? (draft.auditPolicy as Record<string, unknown>)
          : {};

      const [currentRaw, propsRaw] = await Promise.all([
        io.readText(pathsByName.plannerCurrent),
        io.readText(pathsByName.plannerProperties),
      ]);
      await io.writeTextAtomic(
        pathsByName.plannerCurrent,
        helpers.updatePlainKvText(currentRaw, plannerCurrent),
      );
      await io.writeTextAtomic(
        pathsByName.plannerProperties,
        helpers.updateListKvText(propsRaw, plannerProperties),
      );
      await io.writeJsonAtomic(pathsByName.auditPolicy, auditPolicy);

      const snapshotVersion = `openclaw-orch-${new Date()
        .toISOString()
        .replace(/[-:TZ.]/g, "")
        .slice(0, 14)}-${randomUUID().slice(0, 6)}`;

      let snapshotOut = "";
      if (await io.fileExists(pathsByName.snapshotScript)) {
        const scriptRes = await helpers.runScript(
          pathsByName.snapshotScript,
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
      await helpers.emitEvent("config.committed", payload, req);
      sendJson(res, 200, payload);
      return true;
    } finally {
      await helpers.releaseLock();
    }
  }

  if (req.method === "POST" && subPath === "/configs/rollback") {
    const body = await parseJsonBody(req);
    const targetVersionId = typeof body.targetVersionId === "string" ? body.targetVersionId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "rollback from openclaw plugin";

    if (!targetVersionId) {
      sendJson(res, 400, { error: "targetVersionId is required" });
      return true;
    }
    if (!(await io.fileExists(pathsByName.rollbackScript))) {
      sendJson(res, 500, { error: "rollback script not found", path: pathsByName.rollbackScript });
      return true;
    }

    const rollbackRes = await helpers.runScript(
      pathsByName.rollbackScript,
      [targetVersionId, "openclaw", reason],
      repoRoot,
    );
    const payload = {
      rolledBack: true,
      targetVersionId,
      output: rollbackRes.stdout || rollbackRes.stderr,
    };
    await helpers.emitEvent("config.rollback.executed", payload, req);
    sendJson(res, 200, payload);
    return true;
  }

  if (req.method === "GET" && subPath === "/configs/history") {
    sendJson(res, 200, { items: await io.readNdjson(pathsByName.auditHistory) });
    return true;
  }

  return false;
}
