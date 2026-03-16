# `launch_agent_sandbox.sh` Explain

## Purpose

Validates sandbox and ACL constraints, loads runtime profile isolation, and then launches a worker/tester command inside the allowed workspace.

## Inputs And Outputs

Inputs:
- `--role`
- `--task-id`
- `--workspace-root`
- `--run-root`
- optional `--runtime-profile`
- optional `--tasks-root`
- child command after `--`

Outputs:
- sandbox denial records when checks fail
- exported runtime profile environment
- child process execution inside the workspace directory

## Step-By-Step Flow

1. Parse wrapper flags and separate them from the child command.
2. Load sandbox and isolation config from runtime JSON.
3. If sandboxing is disabled, execute the child command directly.
4. Run ACL checks for the declared writable roots.
5. Load and validate the selected runtime profile, exporting its environment variables.
6. Enforce role-specific scope restrictions for worker and tester roles.
7. Set sandbox-related environment variables and run the child command from the workspace root.

## Failure Modes And Safety Checks

- Fails on invalid args or missing child command.
- Writes denial records before exiting when ACL or profile checks fail.
- Rejects missing or invalid runtime profile files when isolation is enabled.
- Prevents worker/tester roles from running with an orchestrator-wide execution scope.

## Key Dependencies

- `enforce_role_acl.sh`
- runtime config JSON
- per-run runtime profile JSON

## Maintenance Notes

- This is a lightweight local sandbox wrapper, not a full OS sandbox.
- If the runtime profile schema changes, update both the JSON reader and the required env checks here.
