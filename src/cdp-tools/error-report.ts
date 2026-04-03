import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CdpTool, ToolContext } from './types.js'
import { DevtoolsStore } from './devtools.js'
import { toolResult } from './helpers.js'

// NOTE: The innerHTML usage in the template below is safe because all user data
// is passed through the esc() function which uses textContent assignment for
// proper HTML entity encoding. No raw user input reaches innerHTML directly.

export function generateHtml(data: {
  errors: any[]
  consoleLogs: any[]
  failedRequests: any[]
  mainProcessLogs: any[]
  stats: any
  timestamp: string
  appUrl: string
}): string {
  const json = JSON.stringify(data)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Error Report — ${data.timestamp}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; line-height: 1.5; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  h1 { color: #f0f6fc; margin-bottom: 8px; font-size: 24px; }
  .subtitle { color: #8b949e; margin-bottom: 24px; }
  .stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px 20px; min-width: 140px; }
  .stat-value { font-size: 28px; font-weight: 600; }
  .stat-label { color: #8b949e; font-size: 13px; }
  .stat-error .stat-value { color: #f85149; }
  .stat-warn .stat-value { color: #d29922; }
  .stat-info .stat-value { color: #58a6ff; }
  .section { margin-bottom: 32px; }
  .section-title { font-size: 18px; color: #f0f6fc; margin-bottom: 12px; border-bottom: 1px solid #30363d; padding-bottom: 8px; }
  .error-group { background: #161b22; border: 1px solid #30363d; border-radius: 6px; margin-bottom: 8px; }
  .error-header { padding: 12px 16px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
  .error-header:hover { background: #1c2128; }
  .error-message { font-family: 'SF Mono', Consolas, monospace; font-size: 13px; color: #f85149; word-break: break-all; flex: 1; }
  .error-count { background: #f8514922; color: #f85149; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; margin-left: 12px; white-space: nowrap; }
  .error-meta { color: #8b949e; font-size: 12px; margin-left: 12px; white-space: nowrap; }
  .error-body { display: none; padding: 12px 16px; border-top: 1px solid #30363d; }
  .error-body.open { display: block; }
  .stack { font-family: 'SF Mono', Consolas, monospace; font-size: 12px; color: #8b949e; white-space: pre-wrap; background: #0d1117; padding: 12px; border-radius: 4px; overflow-x: auto; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 500; }
  .badge-exception { background: #f8514933; color: #f85149; }
  .badge-console { background: #d2992233; color: #d29922; }
  .badge-network { background: #58a6ff33; color: #58a6ff; }
  .log-row { padding: 4px 16px; border-bottom: 1px solid #21262d; font-family: 'SF Mono', Consolas, monospace; font-size: 12px; }
  .log-stderr { color: #f85149; }
  .log-stdout { color: #c9d1d9; }
  .empty { color: #8b949e; padding: 24px; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <h1>Error Report</h1>
  <div class="subtitle" id="subtitle"></div>
  <div class="stats" id="stats"></div>
  <div class="section"><div class="section-title">Errors (grouped)</div><div id="errors"></div></div>
  <div class="section"><div class="section-title">Failed Network Requests</div><div id="network"></div></div>
  <div class="section"><div class="section-title">Console Errors</div><div id="console"></div></div>
  <div class="section"><div class="section-title">Main Process Logs</div><div id="mainlogs"></div></div>
</div>
<script>
const data = ${json};

// Safe text encoding: creates a text node, reads encoded HTML
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

document.getElementById('subtitle').textContent = data.appUrl + ' \\u2014 ' + data.timestamp;

// Stats (static values, no user input in structure)
document.getElementById('stats').innerHTML = [
  { label: 'Error Groups', value: data.errors.length, cls: 'stat-error' },
  { label: 'Total Errors', value: data.stats.totalErrors || 0, cls: 'stat-error' },
  { label: 'Failed Requests', value: data.failedRequests.length, cls: 'stat-warn' },
  { label: 'Console Errors', value: data.consoleLogs.length, cls: 'stat-warn' },
  { label: 'Main Process', value: data.mainProcessLogs.length, cls: 'stat-info' },
].map(function(s) {
  return '<div class="stat ' + s.cls + '"><div class="stat-value">' + s.value + '</div><div class="stat-label">' + esc(s.label) + '</div></div>';
}).join('');

// Errors - all user content passed through esc()
var errorsEl = document.getElementById('errors');
if (data.errors.length === 0) { errorsEl.textContent = 'No errors captured'; errorsEl.className = 'empty'; }
else {
  errorsEl.innerHTML = data.errors.map(function(g, i) {
    var badgeCls = g.source === 'exception' ? 'badge-exception' : g.source === 'network' ? 'badge-network' : 'badge-console';
    return '<div class="error-group"><div class="error-header" onclick="document.getElementById(\\'eb'+i+'\\').classList.toggle(\\'open\\')">'
      + '<span class="error-message">' + esc(g.message) + '</span>'
      + '<span class="badge ' + badgeCls + '">' + esc(g.source) + '</span>'
      + '<span class="error-count">' + g.count + 'x</span>'
      + '<span class="error-meta">' + esc(g.lastSeen) + '</span>'
      + '</div><div class="error-body" id="eb' + i + '">'
      + (g.stack ? '<pre class="stack">' + esc(g.stack) + '</pre>' : '<div class="empty">No stack trace</div>')
      + '</div></div>';
  }).join('');
}

// Failed requests - all user content passed through esc()
var netEl = document.getElementById('network');
if (data.failedRequests.length === 0) { netEl.textContent = 'No failed requests'; netEl.className = 'empty'; }
else {
  netEl.innerHTML = '<div class="error-group">' + data.failedRequests.map(function(r) {
    return '<div class="log-row log-stderr">'
      + '<strong>' + esc(r.method) + '</strong> '
      + '<span style="color:#f85149">' + esc(String(r.status || r.error || 'ERR')) + '</span> '
      + esc(r.url)
      + (r.duration ? ' <span style="color:#8b949e">(' + esc(r.duration) + ')</span>' : '')
      + '</div>';
  }).join('') + '</div>';
}

// Console errors - all user content passed through esc()
var conEl = document.getElementById('console');
if (data.consoleLogs.length === 0) { conEl.textContent = 'No console errors'; conEl.className = 'empty'; }
else {
  conEl.innerHTML = '<div class="error-group">' + data.consoleLogs.slice(-50).map(function(l) {
    return '<div class="log-row log-stderr">' + esc(l.message) + '</div>';
  }).join('') + '</div>';
}

// Main process logs - all user content passed through esc()
var mainEl = document.getElementById('mainlogs');
if (data.mainProcessLogs.length === 0) { mainEl.textContent = 'No main process logs'; mainEl.className = 'empty'; }
else {
  mainEl.innerHTML = '<div class="error-group">' + data.mainProcessLogs.slice(-50).map(function(l) {
    return '<div class="log-row log-' + esc(l.level) + '">[' + esc(l.level) + '] ' + esc(l.message) + '</div>';
  }).join('') + '</div>';
}
</script>
</body>
</html>`
}

export function createErrorReportTools(ctx: ToolContext): CdpTool[] {
  const { bridge, state, screenshotDir } = ctx

  return [
    {
      definition: {
        name: 'electron_error_report',
        description:
          'Generate a self-contained HTML error report from captured errors, console logs, network failures, and main process output. Saves to disk like screenshots. Open in a browser for a Sentry-like dashboard.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => {
        const store = state.devtoolsStore as DevtoolsStore | null
        const appUrl = bridge.connected
          ? await bridge.evaluate('window.location.href').catch(() => 'unknown')
          : 'not connected'

        const errors = store ? store.getGroupedErrors().map(g => ({
          message: g.message,
          source: g.source,
          count: g.count,
          firstSeen: new Date(g.firstSeen * 1000).toISOString(),
          lastSeen: new Date(g.lastSeen * 1000).toISOString(),
          stack: g.stack,
        })) : []

        const consoleLogs = store
          ? store.console.filter(e => e.level === 'error').slice(-100).map(e => ({
              message: e.message,
              timestamp: new Date(e.timestamp * 1000).toISOString(),
            }))
          : []

        const failedRequests = store
          ? store.getNetworkEntries()
              .filter(e => e.error || (e.status !== undefined && e.status >= 400))
              .slice(-50)
              .map(e => ({
                method: e.method,
                url: e.url,
                status: e.status,
                error: e.error,
                duration: e.duration != null ? `${e.duration}ms` : undefined,
              }))
          : []

        const mainProcessLogs = (state.mainProcessLogs || []).slice(-100).map(e => ({
          level: e.level,
          message: e.message,
          timestamp: new Date(e.timestamp * 1000).toISOString(),
        }))

        const totalErrors = errors.reduce((sum, g) => sum + g.count, 0)
        const timestamp = new Date().toISOString()

        const html = generateHtml({
          errors,
          consoleLogs,
          failedRequests,
          mainProcessLogs,
          stats: { totalErrors },
          timestamp,
          appUrl,
        })

        const dir = screenshotDir
        mkdirSync(dir, { recursive: true })
        const filename = `error-report-${Date.now()}.html`
        const filepath = join(dir, filename)
        writeFileSync(filepath, html)

        return toolResult({
          path: filepath,
          summary: {
            errorGroups: errors.length,
            totalErrors,
            failedRequests: failedRequests.length,
            consoleErrors: consoleLogs.length,
            mainProcessLogs: mainProcessLogs.length,
          },
        })
      },
    },
  ]
}
