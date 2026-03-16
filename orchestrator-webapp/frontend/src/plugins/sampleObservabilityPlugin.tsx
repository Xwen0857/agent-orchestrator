/** Sample frontend plugin that contributes one simple dashboard widget. */
import React from 'react'
import { FrontendPlugin } from './runtime'

const plugin: FrontendPlugin = {
  id: 'sample-observability',
  registerWidget: () => (
    <div className="card plugin-card">
      <h3>Plugin Widget</h3>
      <p>Sample Observability Plugin is active.</p>
    </div>
  ),
}

export default plugin
