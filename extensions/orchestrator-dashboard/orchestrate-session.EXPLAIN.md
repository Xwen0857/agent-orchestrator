# `orchestrate-session.ts` Explain

## Purpose

`orchestrate-session.ts` defines the persisted conversation model behind `/orchestrate`. It parses command intent, manages the current draft, generates summaries, normalizes saved JSON state, and decides whether a session is ready to run.

## Inputs And Outputs

Inputs:

- raw `/orchestrate` command text
- persisted session JSON
- user messages from the host SDK
- the current in-memory session object

Outputs:

- normalized session and summary objects
- rendered session summaries for CLI output
- updated draft state after new user input
- runnable summary validation results

## Step-By-Step Flow

1. `parseOrchestrateArgs` extracts a supported subcommand and returns `help` for unknown input.
2. `buildEmptyOrchestrateSession` creates the baseline persisted shape for a new conversation.
3. `applyMessageToDraft` appends user text into the draft and uses lightweight heuristics to infer:
   - risk level
   - requested execution mode
   - project id
   - workspace root
   - budget
   - likely deliverables
4. `appendSessionHistory` prevents immediate duplicate history rows from being appended.
5. `buildSummaryFromDraft` snapshots the current draft into a new versioned summary.
6. `normalizeOrchestrateSummary` and `normalizeOrchestrateSession` repair partially invalid persisted JSON by falling back field-by-field instead of rejecting the whole file.
7. `getRunnableSummary` returns a usable summary only when one exists, is not superseded or consumed, and still contains a non-empty task goal.

## Failure Modes And Safety Checks

- Unsupported subcommands degrade to `help` instead of throwing.
- Duplicate user messages do not create duplicate draft history entries.
- Invalid persisted fields are normalized back to safe defaults.
- `/orchestrate run` free text is rejected through `validateRunCommandPayload`; users must draft first, then summarize.
- Summaries marked `superseded` or `consumed` are intentionally blocked from reuse.

## Key Dependencies

- Node `crypto`
- Node `path`
- session and summary JSON files managed elsewhere in the plugin runtime

## Maintenance Notes

- If the session schema changes, update `buildEmptyOrchestrateSession`, `normalizeOrchestrateSession`, and `renderSessionSummary` together.
- Keep the message inference heuristics in `applyMessageToDraft` conservative. They are a convenience layer, not a source of truth.
- If new subcommands are introduced, update both `OrchestrateSubcommand` and `ORCHESTRATE_SUBCOMMANDS`.
