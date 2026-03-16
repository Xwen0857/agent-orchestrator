import fs from "node:fs/promises";

import { buildObserverCoreRefinementIntake } from "./orchestrate-observer-core-ingress.js";

async function main(): Promise<void> {
  const [, , packetPath, outputPath] = process.argv;
  if (!packetPath || !outputPath) {
    throw new Error(
      "usage: node --import tsx extensions/orchestrator-dashboard/orchestrate-observer-core-ingress-cli.ts <packet_path> <output_path>",
    );
  }
  const packet = JSON.parse(await fs.readFile(packetPath, "utf8")) as Record<string, unknown>;
  const intake = buildObserverCoreRefinementIntake(packet);
  await fs.writeFile(outputPath, `${JSON.stringify(intake, null, 2)}\n`, "utf8");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
