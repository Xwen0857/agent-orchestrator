# Agent Runtime Config

Path:
- shared: `templates/coordination/orchestrator/agent_runtime.json`
- local override: `templates/coordination/orchestrator/agent_runtime.local.json`

Merge order:
1. shared config
2. local override (same keys overwrite shared values)

`llm` fields:
- `enabled`: enable/disable LLM planning enrichment
- `auth_mode`: `standalone | openclaw | auto`
- `api_base_url`: OpenAI-compatible base URL
- `api_key`: optional inline key (prefer local override only; used in `standalone/auto`)
- `api_key_env`: environment variable fallback for API key
- `model`: model id
- `temperature`: 0~1
- `max_tokens`: completion max tokens
- `timeout_ms`: request timeout
- `system_prompt`: planning system instruction

If LLM call fails, orchestrator falls back to deterministic strategy parsing.

Auth mode behavior:
- `standalone`: use `api_key` then `api_key_env`.
- `openclaw`: prefer `api.config.models.providers.<provider>.apiKey`, then provider env (e.g. `OPENAI_API_KEY`, `GEMINI_API_KEY`).
- `auto`: try `standalone`, then `openclaw`.
