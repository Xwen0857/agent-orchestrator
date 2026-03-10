export type TaskAmendmentAuthoritySummary = {
  amendmentCount: number;
  latestAmendment: string;
  latestAmendedAt: string;
  amendmentSource: "task_meta" | "none";
};

function asNonNegativeInt(value: unknown): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

export function readTaskAmendmentAuthority(
  meta: Record<string, unknown>,
): TaskAmendmentAuthoritySummary {
  const amendmentCount = asNonNegativeInt(meta.requirement_amendment_count);
  const latestAmendment =
    typeof meta.latest_requirement_amendment === "string" ? meta.latest_requirement_amendment.trim() : "";
  const latestAmendedAt =
    typeof meta.latest_requirement_amended_at === "string"
      ? meta.latest_requirement_amended_at.trim()
      : "";

  return {
    amendmentCount,
    latestAmendment,
    latestAmendedAt,
    amendmentSource: amendmentCount > 0 || latestAmendment ? "task_meta" : "none",
  };
}

export function renderTaskAmendmentMirror(params: {
  currentText: string;
  amendedAt: string;
  amendment: string;
}): string {
  const line = `- ${params.amendedAt} ${params.amendment}`;
  const current = params.currentText.trim();
  if (!current) {
    return `# Amendments\n\n${line}\n`;
  }
  return `${params.currentText.trimEnd()}\n${line}\n`;
}
