# `orchestrate-command.ts` Explain

## Purpose

`orchestrate-command.ts` provides the command-layer primitives that convert user/session context into script-ready orchestrator payloads. It does not own command routing. It owns three things:

- task and operation id generation
- normalization of free text or structured summaries into `OrchestrateStrategy`
- bounded execution of an allowlisted set of repository shell scripts

## Inputs And Outputs

Inputs:

- raw user text
- normalized summary content
- runtime metadata such as channel, sender, session key, and message thread id
- an allowlisted script name plus validated shell arguments

Outputs:

- a stable `OrchestrateStrategy` object
- a sortable `task_id`
- a deterministic `operation_id`
- `{ stdout, stderr, scriptPath }` from one executed allowlisted script

## Step-By-Step Flow

1. `buildTaskId` generates a time-based id with a sanitized title slug and random suffix.
2. `normalizeFreeTextToStrategy` trims the incoming request, derives a short title, and fills every missing field with orchestrator defaults.
3. `buildStrategyFromSummary` reuses the free-text normalizer, but first filters summary arrays to non-empty string values so the resulting JSON payload stays consistent.
4. `runWhitelistedScript` resolves a symbolic script name through `ORCHESTRATE_SCRIPT_MAP`.
5. Each shell argument is validated for length and allowed characters before the script path is resolved.
6. The chosen script is executed with `execFile`, not a shell string, to keep the process boundary constrained.
7. `buildOperationId` hashes the visible request context so repeated identical requests can be correlated or deduplicated externally.

## Failure Modes And Safety Checks

- Unknown script names are rejected before any filesystem lookup.
- More than 16 script arguments are rejected.
- Script arguments with characters outside the strict allowlist are rejected.
- `execFile` applies a default timeout and max buffer to prevent long-running or overly chatty child processes from hanging the plugin.
- Empty or whitespace-only requests still produce a valid strategy, but the raw request is recorded as `(empty request)` to make the fallback visible.

## Key Dependencies

- Node `child_process.execFile`
- Node `crypto`
- the shell scripts listed in `ORCHESTRATE_SCRIPT_MAP`

## Maintenance Notes

- Keep `ORCHESTRATE_SCRIPT_MAP` aligned with the scripts that the rest of the plugin actually invokes.
- If new fields are added to `OrchestrateStrategy`, update both `normalizeFreeTextToStrategy` and `buildStrategyFromSummary` together.
- If argument validation becomes more permissive, review every called shell script for quoting and path-safety assumptions first.
