# Purpose

`run_keeper.sh` provides a small operator-facing wrapper around `keeper_scheduler.sh` for one-shot execution, loop mode, and a local daemon lifecycle.

# Inputs and Outputs

- Inputs:
  - mode flag: `--once`, `--loop`, `--daemon-start`, `--daemon-stop`, `--daemon-status`
  - optional iteration count for `--loop`
- Outputs:
  - direct scheduler execution for one-shot/loop modes
  - background process plus pid/log files for daemon mode

# Step-By-Step Flow

1. Parse the mode and optional iteration count.
2. Ensure the pid file directory exists.
3. For `--daemon-start`:
   - inspect any existing pid file
   - keep it if the process is still alive
   - remove it if it is stale
   - launch the scheduler with `nohup`
   - record the new pid
4. For `--daemon-stop`:
   - read the pid file when present
   - send a normal `kill`
   - briefly wait
   - escalate to `kill -9` only if the process remains
   - remove the pid file
5. For `--daemon-status`, report whether the pid file points to a live process.
6. For `--once` and `--loop`, invoke `keeper_scheduler.sh` directly.

# Failure Modes and Safety Checks

- Stale pid files are removed before starting a new daemon.
- Existing live daemons are not replaced silently.
- Forced termination is only used after a graceful stop attempt.

# Key Dependencies

- `keeper/scripts/keeper_scheduler.sh`
- pid file at `templates/coordination/orchestrator/.keeper-scheduler.pid`
- log file at `templates/coordination/orchestrator/keeper-scheduler.log`

# Maintenance Notes

- The daemon logic assumes the scheduler can be safely restarted as a single process. If keeper becomes multi-process, the pid file contract will need to change.
