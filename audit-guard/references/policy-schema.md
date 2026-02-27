# Policy Schema

每条策略规则最少包含以下字段：

- `rule_id`: 唯一标识
- `tier`: `CRITICAL|HIGH|MONITORED`
- `match_type`: `command|path|resource|behavior|heuristic`
- `match_expr`: 匹配表达式（字符串或正则）
- `default_action`: `ALLOW|MONITOR|BLOCK_PENDING_APPROVAL|BLOCK`
- `requires_master_approval`: `true|false`
- `freeze_scope`: `operation|queue|agent`
- `cooldown_minutes`: 规则命中后的冷却时间
- `enabled`: `true|false`
- `owner`: 规则责任人

示例：

```yaml
- rule_id: AG-R001
  tier: CRITICAL
  match_type: command
  match_expr: "^git\\s+push\\s+--force"
  default_action: BLOCK_PENDING_APPROVAL
  requires_master_approval: true
  freeze_scope: operation
  cooldown_minutes: 60
  enabled: true
  owner: security
```
