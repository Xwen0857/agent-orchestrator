/**
 * Frontend API helpers for the operator webapp.
 * This module centralizes request headers, JSON error handling, and the small set of
 * backend routes consumed by the current UI.
 */
import { CurrentConfig, EventRecord, Overview, PluginInfo } from './types'

const headers = {
  'Content-Type': 'application/json',
  'X-User': 'dev-operator',
  'X-Email': 'dev-operator@local',
  'X-Role': 'operator',
}

async function json<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  // Normalize non-2xx responses into thrown errors so callers can handle API failures
  // through one promise-based path.
  const resp = await fetch(input, init)
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(err || `HTTP ${resp.status}`)
  }
  return resp.json() as Promise<T>
}

/** Fetch the current overview payload for dashboard and system health cards. */
export function getOverview() {
  return json<Overview>('/api/v1/core/overview', { headers })
}

/** Fetch the current editable planner and audit config surfaces. */
export function getCurrentConfig() {
  return json<CurrentConfig>('/api/v1/core/configs/current', { headers })
}

/** Validate a draft config before attempting a commit. */
export function validateConfig(draft: CurrentConfig, reason: string) {
  return json<{ valid: boolean; requiresApproval: boolean; riskLevel: string; issues: Array<{ source: string; key: string; level: string; message: string }> }>('/api/v1/core/configs/validate', {
    method: 'POST',
    headers,
    body: JSON.stringify({ draft, reason }),
  })
}

/** Commit a validated config draft, optionally with an approval id for high-risk changes. */
export function commitConfig(draft: CurrentConfig, reason: string, approvalId?: string) {
  return json<{ committed: boolean; snapshotVersion: string; traceId: string }>('/api/v1/core/configs/commit', {
    method: 'POST',
    headers,
    body: JSON.stringify({ draft, reason, approvalId }),
  })
}

/** List registered backend plugins. */
export function getPlugins() {
  return json<{ items: PluginInfo[] }>('/api/v1/ext/plugins', { headers })
}

/** Register one plugin manifest with the backend plugin registry. */
export function registerPlugin(manifestPath: string) {
  return json('/api/v1/ext/plugins/register', {
    method: 'POST',
    headers,
    body: JSON.stringify({ manifestPath }),
  })
}

/** Fetch the recent backend event stream used by the event viewer. */
export function getEvents() {
  return json<{ items: EventRecord[] }>('/api/v1/events?limit=100', { headers })
}
