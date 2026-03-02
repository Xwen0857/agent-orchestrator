import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolveExistingPath } from "./orchestrate-io.js";

export type RuntimeSignatureFileSpec = {
  id: string;
  candidates: string[];
};

export type RuntimeConsistencySnapshot = {
  runtimeConsistency: "ok" | "mismatch";
  runtimeSignature: string;
  runtimeExpectedSignature: string;
};

export type RuntimeConsistencyController = {
  assertRuntimeConsistency: (
    stage: "startup" | "command",
  ) => Promise<{
    runtimeConsistency: "ok" | "mismatch";
    runtimeSignature: string;
    expected: string;
  }>;
  getSnapshot: () => RuntimeConsistencySnapshot;
  getStartupError: () => string;
  startupConsistencyPromise: Promise<
    | {
        runtimeConsistency: "ok" | "mismatch";
        runtimeSignature: string;
        expected: string;
      }
    | null
  >;
};

export type BuildRuntimeConsistencyControllerParams = {
  runtimeSignatureFiles: RuntimeSignatureFileSpec[];
  runtimeSignaturePath: string;
  consistencyMode: "enforce" | "warn";
  readJsonOrDefault: <T>(targetPath: string, fallback: T) => Promise<T>;
  readText: (targetPath: string) => Promise<string>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
  mismatchCode: string;
};

export function buildRuntimeMismatchMessage(params: {
  mismatchCode: string;
  expectedSignature: string;
  actualSignature: string;
  signaturePath: string;
}): string {
  return [
    `code: ${params.mismatchCode}`,
    `message: runtime signature mismatch (expected=${params.expectedSignature}, actual=${params.actualSignature})`,
    `signature_file: ${params.signaturePath}`,
    "fix: cd extensions/orchestrator-dashboard && bash scripts/gen-runtime-signature.sh",
  ].join("\n");
}

export function buildRuntimeConsistencyController(
  params: BuildRuntimeConsistencyControllerParams,
): RuntimeConsistencyController {
  let runtimeConsistency: "ok" | "mismatch" = "ok";
  let runtimeSignature = "";
  let runtimeSignatureExpected = "";
  let startupConsistencyError = "";

  const computeRuntimeSignature = async (): Promise<string> => {
    const hash = createHash("sha256");
    for (const fileSpec of params.runtimeSignatureFiles) {
      const filePath = resolveExistingPath(fileSpec.candidates);
      if (!filePath || !existsSync(filePath)) {
        throw new Error(`runtime signature source missing: ${fileSpec.id}`);
      }
      hash.update(fileSpec.id);
      hash.update("\n");
      const content = await params.readText(filePath);
      hash.update(content);
      hash.update("\n");
    }
    return hash.digest("hex");
  };

  const loadExpectedRuntimeSignature = async (): Promise<string> => {
    const doc = await params.readJsonOrDefault<Record<string, unknown>>(params.runtimeSignaturePath, {});
    const raw = doc.signature;
    return typeof raw === "string" ? raw.trim() : "";
  };

  const assertRuntimeConsistency: RuntimeConsistencyController["assertRuntimeConsistency"] = async (
    stage,
  ) => {
    const actual = await computeRuntimeSignature();
    const expected = await loadExpectedRuntimeSignature();
    runtimeSignature = actual;
    runtimeSignatureExpected = expected;

    if (expected && expected === actual) {
      runtimeConsistency = "ok";
      return { runtimeConsistency, runtimeSignature, expected };
    }

    runtimeConsistency = "mismatch";
    const message = buildRuntimeMismatchMessage({
      mismatchCode: params.mismatchCode,
      expectedSignature: expected || "(missing)",
      actualSignature: actual,
      signaturePath: params.runtimeSignaturePath,
    });
    await params.emitEvent("orchestrate.runtime.mismatch", {
      stage,
      expected_signature: expected || "(missing)",
      runtime_signature: actual,
      consistency_mode: params.consistencyMode,
    });
    if (params.consistencyMode === "enforce") {
      throw new Error(message);
    }
    return { runtimeConsistency, runtimeSignature, expected };
  };

  const startupConsistencyPromise = assertRuntimeConsistency("startup").catch((err) => {
    startupConsistencyError = err instanceof Error ? err.message : String(err);
    return null;
  });

  return {
    assertRuntimeConsistency,
    getSnapshot: () => ({
      runtimeConsistency,
      runtimeSignature,
      runtimeExpectedSignature: runtimeSignatureExpected,
    }),
    getStartupError: () => startupConsistencyError,
    startupConsistencyPromise,
  };
}
