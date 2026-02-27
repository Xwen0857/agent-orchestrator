# Knowledge Base

Entry path:

- `knowledge-base/entries/<date>-<slug>.md`

Keeper queue path:

- `knowledge-base/inbox/pending/*.json`
- `knowledge-base/inbox/processed/*.json`
- `knowledge-base/inbox/rejected/*.json`

Required metadata in each entry:

- `entry_id`
- `tags`
- `last_verified_at`
- `applicability_scope`
- `score`
- `status`

Scripts:

1. `agent-orchestrator/scripts/kb_submit_candidate.sh` (recommended when `keeper_enabled=true`)
2. `keeper/scripts/keeper_ingest_candidates.sh` (keeper ingests candidates)
2.1 `keeper/scripts/kb_semantic_dedupe.py` (semantic dedupe scoring)
2.2 `keeper/scripts/keeper_scheduler.sh` (periodic keeper cycles)
2.3 `scripts/run_keeper.sh` (one-command once/loop/daemon control)
3. `agent-orchestrator/scripts/kb_add_entry.sh` (direct write allowed only when `keeper_enabled=false`; keeper path uses `KEEPER_MODE=true`)
4. `agent-orchestrator/scripts/kb_search.sh`
5. `agent-orchestrator/scripts/task_link_kb.sh`
6. `agent-orchestrator/scripts/kb_ranked_search.sh`
7. `agent-orchestrator/scripts/kb_record_feedback.sh`
8. `agent-orchestrator/scripts/kb_recompute_scores.sh`
9. `audit-guard/scripts/record_kb_feedback.sh`

Write policy switch:

1. `keeper_enabled=true`: functional agents submit candidates, keeper writes KB.
2. `keeper_enabled=false`: direct `kb_add_entry.sh` remains available.

Prompt templates:

1. `knowledge-base/prompts/kb_ingestion_prompt.md`

Scoring model:

1. `knowledge-base/references/weighting-model.md`

Feedback log:

1. `knowledge-base/feedback/kb_feedback.ndjson`
