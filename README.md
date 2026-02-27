# Agent Orchestrator Suite

Local-first multi-agent orchestration framework for planning, scheduling, execution, testing, audit, and controlled artifact release.

## What It Contains

- `openclaw/extensions/orchestrator-dashboard`: the OpenClaw plugin entrypoint and dashboard surface
- `agent-orchestrator/scripts`: the orchestration state machine, scheduler, ACL, workspace, and release scripts
- `planner-core`, `scheduler-ops`, `worker-delivery`, `tester-ephemeral`, `audit-guard`: role definitions
- `templates/coordination`: runtime templates, planner config, audit policy, and task metadata schemas
- `openclaw/`: the embedded OpenClaw host used to run the plugin locally

## Core Flow

The current primary entry flow is session-driven:

1. `/orchestrate start`
2. Continue the conversation to define goal, workspace, constraints, and mode preferences
3. `/orchestrate summary`
4. `/orchestrate run`

The plugin converts the session summary into task strategy input, then hands execution to:

- `planner-core`: modeling, mode selection, and task preparation
- `scheduler-ops`: queue selection, dispatch, retry, and recovery
- `worker-delivery`: implementation
- `tester-ephemeral`: verification
- `audit-guard`: policy and release gate enforcement

## Repository Policy

This repository intentionally excludes:

- local OpenClaw state
- generated task runs
- archived task outputs
- workspace runtime artifacts
- local secrets and machine-specific overrides

Only source, templates, docs, and reproducible scripts should be committed.

## Local Validation

From the repository root:

```bash
cd openclaw
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec vitest run src/plugins/orchestrator-dashboard.plugin.test.ts
```

## Publishing

This repository is suitable for public GitHub hosting once local runtime artifacts are excluded by `.gitignore`.
