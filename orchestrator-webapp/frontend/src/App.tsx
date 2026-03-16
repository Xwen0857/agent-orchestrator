/**
 * Main single-page operator console UI.
 * This component loads the initial backend state, owns tab selection, and handles
 * config validation/commit plus basic plugin registration flows.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  commitConfig,
  getCurrentConfig,
  getEvents,
  getOverview,
  getPlugins,
  registerPlugin,
  validateConfig,
} from './api'
import { CurrentConfig, EventRecord, Overview, PluginInfo } from './types'
import { loadWidgets } from './plugins/runtime'

const tabs = ['Dashboard', 'Config Studio', 'Extensions', 'Events'] as const

type Tab = (typeof tabs)[number]

export function App() {
  const [tab, setTab] = useState<Tab>('Dashboard')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [config, setConfig] = useState<CurrentConfig | null>(null)
  const [draftText, setDraftText] = useState('')
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [events, setEvents] = useState<EventRecord[]>([])
  const [widgets, setWidgets] = useState<React.ReactNode[]>([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    // Load the initial dashboard, config, plugin, and event snapshots together so
    // the UI renders from one coherent first fetch.
    Promise.all([getOverview(), getCurrentConfig(), getPlugins(), getEvents()])
      .then(async ([ov, cfg, pls, evs]) => {
        setOverview(ov)
        setConfig(cfg)
        setDraftText(JSON.stringify(cfg, null, 2))
        setPlugins(pls.items)
        setEvents(evs.items)
        setWidgets(await loadWidgets(pls.items.filter((p) => p.enabled).map((p) => p.id)))
      })
      .catch((err) => setMessage(String(err)))
  }, [])

  const pendingActions = useMemo(() => {
    const arr = (overview?.dashboard?.pending_actions as Array<Record<string, unknown>> | undefined) || []
    return arr.length
  }, [overview])

  async function onValidate() {
    // Validation works against the JSON editor payload rather than the last committed
    // config object so operators can iterate on draft edits locally.
    if (!config) return
    try {
      const draft = JSON.parse(draftText) as CurrentConfig
      const res = await validateConfig(draft, 'validate from webapp')
      setMessage(`validate=${res.valid}, risk=${res.riskLevel}, requiresApproval=${res.requiresApproval}`)
    } catch (err) {
      setMessage(String(err))
    }
  }

  async function onCommit() {
    if (!config) return
    try {
      const draft = JSON.parse(draftText) as CurrentConfig
      const res = await commitConfig(draft, 'commit from webapp')
      setMessage(`commit ok, snapshot=${res.snapshotVersion}`)
      setConfig(draft)
    } catch (err) {
      setMessage(String(err))
    }
  }

  async function onRegisterSample() {
    try {
      await registerPlugin('orchestrator-webapp/backend/plugins/sample_observability/plugin.manifest.json')
      const pls = await getPlugins()
      setPlugins(pls.items)
      setWidgets(await loadWidgets(pls.items.filter((p) => p.enabled).map((p) => p.id)))
      setMessage('sample plugin registered')
    } catch (err) {
      setMessage(String(err))
    }
  }

  return (
    <div className="layout">
      <header className="topbar">
        <h1>Orchestrator Console</h1>
        <div className="tabs">
          {tabs.map((x) => (
            <button key={x} className={x === tab ? 'active' : ''} onClick={() => setTab(x)}>
              {x}
            </button>
          ))}
        </div>
      </header>

      {message && <div className="banner">{message}</div>}

      {tab === 'Dashboard' && (
        // Dashboard focuses on high-level status plus any optional plugin widgets.
        <main className="grid">
          <section className="card">
            <h2>System</h2>
            <p>Status: {String(overview?.systemHealth?.status ?? 'UNKNOWN')}</p>
            <p>Open Tasks: {String((overview?.dashboard?.system_health as Record<string, unknown> | undefined)?.open_tasks ?? 0)}</p>
            <p>Pending Actions: {pendingActions}</p>
          </section>
          <section className="card">
            <h2>Risk Feed</h2>
            <pre>{JSON.stringify(overview?.dashboard?.pending_actions ?? [], null, 2)}</pre>
          </section>
          {widgets}
        </main>
      )}

      {tab === 'Config Studio' && (
        // Config Studio intentionally exposes raw JSON so the backend config service
        // can stay schema-flexible while the UI remains lightweight.
        <main className="grid single">
          <section className="card">
            <h2>Draft Editor (JSON)</h2>
            <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={28} />
            <div className="actions">
              <button onClick={onValidate}>Validate Draft</button>
              <button onClick={onCommit}>Commit Draft</button>
            </div>
          </section>
        </main>
      )}

      {tab === 'Extensions' && (
        <main className="grid single">
          <section className="card">
            <h2>Plugin Registry</h2>
            <button onClick={onRegisterSample}>Register Sample Plugin</button>
            <pre>{JSON.stringify(plugins, null, 2)}</pre>
          </section>
        </main>
      )}

      {tab === 'Events' && (
        <main className="grid single">
          <section className="card">
            <h2>Recent Events</h2>
            <pre>{JSON.stringify(events, null, 2)}</pre>
          </section>
        </main>
      )}
    </div>
  )
}
