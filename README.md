# Agent Orchestrator

`Agent Orchestrator` is a local-first multi-agent orchestration framework for turning natural-language intent into planned, scheduled, tested, audited, and publishable work.

It is built for people who want more than a single “prompt in, code out” loop. Instead of collapsing everything into one opaque agent, this project separates the workflow into explicit roles with explicit boundaries.

The result is a system that aims to be:

- easier to reason about
- easier to extend
- safer to operate
- better suited for real engineering workflows

`planner-core` is a decoupling-first planning agent, not a threshold-based splitter.

## Why This Project Exists

Most agent systems blur together:

- intake
- planning
- dispatch
- implementation
- testing
- audit

That makes them hard to debug, hard to control, and hard to trust.

`Agent Orchestrator` takes the opposite approach: each stage is modeled as a distinct responsibility, with role boundaries, state transitions, and a path toward stronger isolation over time.

This project is designed to evolve from:

- local-thread execution

toward:

- containerized agent execution
- eventually distributed orchestration

without requiring the architecture to be rewritten from scratch.

## What It Does

At a high level, the system turns a user request into a controlled execution pipeline:

1. capture intent and configuration
2. model and decompose the task
3. schedule runnable work
4. execute delivery
5. validate outputs
6. audit and gate release

The current orchestration chain is:

`entry agent -> planner -> scheduler -> worker/tester -> audit`

## Key Features

### Session-Driven Orchestration

The primary user-facing flow is conversation-based:

1. `/orchestrate start`
2. continue the conversation to define the goal and configuration
3. `/orchestrate summary`
4. review and refine
5. `/orchestrate run`

This avoids one-shot command execution and gives the system a structured pre-execution phase.

### Explicit Role Boundaries

The system treats major functions as separate roles, rather than hiding everything behind one generic agent:

- `planner-core`
- `scheduler-ops`
- `worker-delivery`
- `tester-ephemeral`
- `audit-guard`

This makes responsibility traceable and keeps the execution chain more understandable.

### Workspace and ACL Direction

The project is moving toward a workspace-first execution model:

- source and templates remain stable
- runtime work happens in isolated work domains
- role-based ACL and runtime controls reduce accidental cross-boundary writes

### Release-Oriented Control Flow

The orchestration model is not just about generating artifacts. It is built around:

- state transitions
- verification
- approval gates
- controlled release behavior

That is the foundation for safer multi-step agent automation.

## Architecture Overview

### Entry Layer

The entry experience is currently exposed through the OpenClaw plugin command surface.

It collects:

- task goals
- workspace and project hints
- constraints
- risk and budget preferences

The entry phase produces a structured summary before execution begins.

### Planner

Planning is separated from scheduling:

- `planner-core` handles requirement modeling, decoupling-first decomposition, and task preparation
- `scheduler-ops` handles queue selection, dispatch, retry, recovery, and concurrency control

This distinction matters: planning decides what should happen, scheduling decides when and how it should run.

Current planner dependency model:

- `planner-core` outputs a minimal leaf dependency chain (`module -> component -> depends_on_leaf_ids`).
- The chain is a planning-time coordination hint (`component_semantic_linearized`), not a full scheduler DAG.
- Current downstream consumption is status/release summary visibility, not runtime dependency gating.
- Planner view rendering uses a dedicated projection layer (`orchestrate-planner-projection.ts`) so view-model only composes response payloads.
- Dependency semantics are split into:
  - `planner_dependency_semantics.json` for component dependency map
  - `planner_dependency_defaults.json` for fallback mode/note/summary defaults

When to evolve into a full DAG:

- scheduler needs dependency-aware release/concurrency control
- replan needs dependency-scoped partial recompute
- tester/observer needs dependency-based blockage tracing
- UI requires interactive dependency graph operations

Until one of the above becomes an implemented consumer, the dependency model stays frozen at the minimal validated shape.

Planner invariants are centralized at:

- `templates/coordination/orchestrator/planner_invariants.md`

Planner boundary matrix:

- `orchestrate-planner-contract.ts`: types and re-export barrel only.
- `orchestrate-planner-split-plan-contract.ts`: split-plan normalize/validate/fail-fast only.
- `orchestrate-planner-projection.ts`: planner semantic projection only.
- `orchestrate-view-model.ts`: response parameter composition only.

Split-plan pipeline:

1. `orchestrate-planner-split-plan-schema.ts`: schema normalize/migration
2. `orchestrate-planner-split-plan-parse.ts`: field extraction and type narrowing
3. `orchestrate-planner-split-plan-validate.ts`: invariant and dependency consistency checks
4. `orchestrate-planner-split-plan-summary.ts`: dependency summary + fallback assembly
5. `orchestrate-planner-split-plan-contract.ts`: facade orchestration entry (`extractSplitPlan`)

Allowed import directions:

- `projection -> contract/errors/hints`
- `view-model -> projection/response`
- `response -> dependency-semantics`

Prohibited backflow:

- `view-model -> split-plan-contract`
- `run/status/agent-runtime -> split-plan-contract`

Planner change entry order:

1. update planner contract types and semantics/defaults configs
2. update split-plan validation/projection
3. update view-model/response consumption
4. update scripts and tests

Split-plan field change rule:

- Any new `split_plan`/`refinement_partition` field must be updated together in parse + validate + summary test coverage.

### Execution

- `worker-delivery` performs implementation work
- `tester-ephemeral` validates the produced output
- `audit-guard` performs policy and release checks

This keeps delivery, validation, and governance from collapsing into one uncontrolled step.

## Repository Structure

### Core Orchestration

- `agent-orchestrator/`

Shell scripts, execution logic, state transitions, and orchestration references live here.

### Role Definitions

- `planner-core/`
- `planner-ops/`
- `scheduler-ops/`
- `worker-delivery/`
- `tester-ephemeral/`
- `audit-guard/`
- `requirement-intake/`
- `keeper/`
- `governance-config/`

These define role behavior, operating expectations, and supporting guidance.

### Coordination Templates

- `templates/coordination/`

This is the canonical template and metadata layer for:

- planner config
- audit policy
- security policy
- task folder templates
- worker lifecycle templates
- orchestrator runtime templates

### OpenClaw Integration

- `extensions/orchestrator-dashboard/`

OpenClaw is treated as an external host dependency, not as repository content.

The main plugin package lives in this repository under:

- `extensions/orchestrator-dashboard`

and is intended to be installed into a separate OpenClaw checkout or deployment.

### Supporting Systems

- `knowledge-base/`
- `orchestrator-webapp/`
- `extensions/`
- `scripts/`

These provide additional support layers for memory, UI, registry, and operational tooling.

## Current Status

Implemented or actively integrated:

- session-based `/orchestrate` command flow
- planner and scheduler responsibility split
- local-thread orchestration scripts
- task state machine and transition logic
- workspace and ACL scaffolding
- parent/child aggregation and release-oriented script paths
- runtime consistency checks for the orchestrator plugin
- plugin-level test coverage for the new command flow

Still evolving:

- fully polished workspace-first output publishing
- stronger end-to-end runtime isolation
- broader audit automation
- container execution adapters
- distributed execution adapters
- more complete operator-facing UX

This is an actively evolving engineering project, not a finished productized platform.

## Quick Start

### Clone the Repository

```bash
git clone https://github.com/Xwen0857/agent-orchestrator.git
cd agent-orchestrator
```

### Install into OpenClaw

OpenClaw is the external host runtime for this project. Clone OpenClaw separately, then use [`scripts/install_openclaw_plugin.sh`](./scripts/install_openclaw_plugin.sh) to link this plugin into that host:

```bash
bash scripts/install_openclaw_plugin.sh /path/to/openclaw
```

The installer creates a symlink from this repository's `extensions/orchestrator-dashboard` package into the target OpenClaw checkout, which keeps local plugin changes live during development.

### Validate the Plugin Layer

Run validation inside the target OpenClaw host checkout after the plugin is installed:

```bash
cd /path/to/openclaw
pnpm exec tsc -p tsconfig.json --noEmit
```

This TypeScript check validates that the linked plugin is compatible with the host's current plugin API surface.

Run plugin-local tests from this repository separately:

```bash
cd extensions/orchestrator-dashboard
pnpm install
pnpm test
```

Or use the repository helper:

```bash
bash scripts/test_orchestrator_plugin.sh
```

Host compatibility validation and plugin-local tests are intentionally separate checks.

## Development Notes

### Main Working Areas

- orchestration scripts: `agent-orchestrator/scripts`
- plugin entry surface: `extensions/orchestrator-dashboard`
- runtime templates: `templates/coordination`

### Prerequisites

- Git
- Node.js with `pnpm`
- Python 3
- `jq`

## Open Source Boundaries

This repository is prepared for public hosting by excluding local-only and runtime-generated content.

Examples of intentionally excluded data:

- `.openclaw/`
- `.openclaw-state/`
- `openclaw/`
- active task run outputs
- archived task artifacts
- runtime workdomains
- local secret overrides
- generated logs and caches

Only source code, templates, reproducible scripts, and documentation should be committed.

## Project Direction

The long-term direction is not “make one giant agent smarter.”

It is:

- make the workflow more explicit
- make role boundaries stronger
- make execution safer
- make deployment more portable

That is the architectural bet behind this repository.

## License

Released under the MIT License. See [`LICENSE`](./LICENSE).
