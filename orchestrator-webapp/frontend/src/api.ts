import { CurrentConfig, EventRecord, Overview, PluginInfo } from './types'

const headers = {
  'Content-Type': 'application/json',
  'X-User': 'dev-operator',
  'X-Email': 'dev-operator@local',
  'X-Role': 'operator',
}

async function json<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const resp = await fetch(input, init)
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(err || `HTTP ${resp.status}`)
  }
  return resp.json() as Promise<T>
}

export function getOverview() {
  return json<Overview>('/api/v1/core/overview', { headers })
}

export function getCurrentConfig() {
  return json<CurrentConfig>('/api/v1/core/configs/current', { headers })
}

export function validateConfig(draft: CurrentConfig, reason: string) {
  return json<{ valid: boolean; requiresApproval: boolean; riskLevel: string; issues: Array<{ source: string; key: string; level: string; message: string }> }>('/api/v1/core/configs/validate', {
    method: 'POST',
    headers,
    body: JSON.stringify({ draft, reason }),
  })
}

export function commitConfig(draft: CurrentConfig, reason: string, approvalId?: string) {
  return json<{ committed: boolean; snapshotVersion: string; traceId: string }>('/api/v1/core/configs/commit', {
    method: 'POST',
    headers,
    body: JSON.stringify({ draft, reason, approvalId }),
  })
}

export function getPlugins() {
  return json<{ items: PluginInfo[] }>('/api/v1/ext/plugins', { headers })
}

export function registerPlugin(manifestPath: string) {
  return json('/api/v1/ext/plugins/register', {
    method: 'POST',
    headers,
    body: JSON.stringify({ manifestPath }),
  })
}

export function getEvents() {
  return json<{ items: EventRecord[] }>('/api/v1/events?limit=100', { headers })
}
