# `config_service.py` Explain

## Purpose

Coordinates config reads, draft validation, commits, rollbacks, and plugin hook fan-out for the backend control plane.

## Inputs And Outputs

Inputs:
- planner current markdown
- planner properties markdown
- audit policy JSON
- config history NDJSON
- snapshot and rollback helper scripts
- plugin registry/runtime services
- event bus and audit service

Outputs:
- normalized current config responses
- validation responses with inferred risk and changed keys
- committed config writes plus snapshot versions
- rollback payloads

## Step-By-Step Flow

1. Read the current config surfaces from disk and parse their text/JSON formats.
2. Validate drafts by:
   - checking required keys
   - enforcing numeric property constraints
   - validating audit policy shape
   - inferring risk from changed keys and rule changes
   - running validator plugins
3. Emit validation events and audit records.
4. On commit:
   - re-validate
   - enforce approval requirements for high-risk changes
   - acquire the config lock
   - persist config files
   - run the snapshot script
   - emit commit events and audit records
   - notify event-handler plugins
5. On rollback:
   - enforce operator/approver role
   - run the rollback script
   - emit rollback events and audit records
   - notify event-handler plugins

## Failure Modes And Safety Checks

- Drafts with validation errors fail before any write.
- High-risk commits require approval unless performed by an approver.
- Config writes occur inside an exclusive lock scope.
- Helper script failures surface as HTTP errors instead of silently continuing.
- Plugin validator failures are converted into validation issues.

## Key Dependencies

- `PluginRegistryService`
- `PluginRuntime`
- `EventBus`
- `AuditService`
- file-store atomic write helpers
- snapshot/rollback helper scripts

## Maintenance Notes

- Keep the text parsing/rendering rules aligned with the actual config file formats on disk.
- If plugin capabilities or permissions change, update the validator and event-handler hook filters here.
- Changes to risk inference should be reflected anywhere the UI describes approval requirements.
