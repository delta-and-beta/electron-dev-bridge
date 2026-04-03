import type { CdpTool, ToolContext } from './types.js'
import { toolResult } from './helpers.js'

const MAX_CONSOLE_ENTRIES = 1000
const MAX_NETWORK_ENTRIES = 500
const MAX_ERROR_ENTRIES = 500
const MAX_BODY_LENGTH = 1024

export interface ConsoleEntry {
  level: string
  message: string
  timestamp: number
}

export interface NetworkEntry {
  requestId: string
  method: string
  url: string
  status?: number
  statusText?: string
  error?: string
  body?: string
  startTime: number
  endTime?: number
  duration?: number
}

export interface ErrorEntry {
  message: string
  stack?: string
  source: 'exception' | 'unhandledrejection' | 'console.error' | 'network'
  url?: string
  line?: number
  column?: number
  timestamp: number
  fingerprint: string
}

export interface ErrorGroup {
  fingerprint: string
  message: string
  source: string
  count: number
  firstSeen: number
  lastSeen: number
  stack?: string
  samples: Array<{ timestamp: string; url?: string; line?: number }>
}

function errorFingerprint(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/https?:\/\/[^\s)]+/g, '<url>')
    .trim()
}

export class DevtoolsStore {
  console: ConsoleEntry[] = []
  network: Map<string, NetworkEntry> = new Map()
  errors: ErrorEntry[] = []
  pendingRequests: Set<string> = new Set()
  private attached = false
  private client: any = null

  private addError(entry: ErrorEntry): void {
    this.errors.push(entry)
    if (this.errors.length > MAX_ERROR_ENTRIES) {
      this.errors.splice(0, this.errors.length - MAX_ERROR_ENTRIES)
    }
  }

  getGroupedErrors(): ErrorGroup[] {
    const groups = new Map<string, ErrorGroup>()
    for (const err of this.errors) {
      const existing = groups.get(err.fingerprint)
      if (existing) {
        existing.count++
        existing.lastSeen = err.timestamp
        if (existing.samples.length < 3) {
          existing.samples.push({
            timestamp: new Date(err.timestamp * 1000).toISOString(),
            url: err.url,
            line: err.line,
          })
        }
      } else {
        groups.set(err.fingerprint, {
          fingerprint: err.fingerprint,
          message: err.message,
          source: err.source,
          count: 1,
          firstSeen: err.timestamp,
          lastSeen: err.timestamp,
          stack: err.stack,
          samples: [{
            timestamp: new Date(err.timestamp * 1000).toISOString(),
            url: err.url,
            line: err.line,
          }],
        })
      }
    }
    return Array.from(groups.values()).sort((a, b) => b.lastSeen - a.lastSeen)
  }

  attach(client: any): void {
    if (this.attached) return
    this.attached = true
    this.client = client

    client.Runtime.exceptionThrown(({ timestamp, exceptionDetails }: any) => {
      const ex = exceptionDetails
      const message = ex.exception?.description || ex.text || 'Unknown error'
      const stack = ex.exception?.description || ex.stackTrace?.callFrames
        ?.map((f: any) => `  at ${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber}:${f.columnNumber})`)
        .join('\n')

      this.addError({
        message,
        stack,
        source: 'exception',
        url: ex.url,
        line: ex.lineNumber,
        column: ex.columnNumber,
        timestamp,
        fingerprint: errorFingerprint(message),
      })
    })

    client.Runtime.consoleAPICalled(({ type, args, timestamp }: any) => {
      const message = (args || [])
        .map((a: any) => a.value ?? a.description ?? String(a.type))
        .join(' ')

      this.console.push({ level: type, message, timestamp })

      if (this.console.length > MAX_CONSOLE_ENTRIES) {
        this.console.splice(0, this.console.length - MAX_CONSOLE_ENTRIES)
      }

      if (type === 'error') {
        this.addError({
          message,
          source: 'console.error',
          timestamp,
          fingerprint: errorFingerprint(message),
        })
      }
    })

    client.Network.requestWillBeSent(({ requestId, request, timestamp }: any) => {
      if (this.network.size >= MAX_NETWORK_ENTRIES) {
        const oldest = this.network.keys().next().value!
        this.network.delete(oldest)
      }
      this.pendingRequests.add(requestId)
      this.network.set(requestId, {
        requestId,
        method: request.method,
        url: request.url,
        startTime: timestamp,
      })
    })

    client.Network.responseReceived(({ requestId, response }: any) => {
      const entry = this.network.get(requestId)
      if (entry) {
        entry.status = response.status
        entry.statusText = response.statusText
      }
    })

    client.Network.loadingFinished(({ requestId, timestamp }: any) => {
      this.pendingRequests.delete(requestId)
      const entry = this.network.get(requestId)
      if (entry) {
        entry.endTime = timestamp
        entry.duration = Math.round((timestamp - entry.startTime) * 1000)

        // Capture response body (fire-and-forget, truncated)
        this.client?.Network.getResponseBody({ requestId }).then(
          ({ body }: { body: string }) => {
            if (body) {
              entry.body = body.length > MAX_BODY_LENGTH
                ? body.slice(0, MAX_BODY_LENGTH) + '...'
                : body
            }
          },
          () => {
            // Body not available (e.g. redirects, cancelled) — ignore
          },
        )
      }
    })

    client.Network.loadingFailed(({ requestId, errorText, timestamp }: any) => {
      this.pendingRequests.delete(requestId)
      const entry = this.network.get(requestId)
      if (entry) {
        entry.error = errorText
        this.addError({
          message: `Network error: ${errorText} — ${entry.method} ${entry.url}`,
          source: 'network',
          url: entry.url,
          timestamp: timestamp || entry.startTime,
          fingerprint: errorFingerprint(`Network error: ${errorText} — ${entry.method}`),
        })
      }
    })
  }

  detach(): void {
    this.attached = false
  }

  clearConsole(): void {
    this.console = []
  }

  clearNetwork(): void {
    this.network.clear()
  }

  clearErrors(): void {
    this.errors = []
  }

  clearAll(): void {
    this.clearConsole()
    this.clearNetwork()
    this.clearErrors()
  }

  getNetworkEntries(): NetworkEntry[] {
    return Array.from(this.network.values())
  }
}

export function createDevtoolsTools(ctx: ToolContext): CdpTool[] {
  const { bridge, state } = ctx

  return [
    {
      definition: {
        name: 'electron_get_console_logs',
        description:
          'Get captured console messages from the Electron app. Captures console.log/info/warn/error/debug calls.',
        inputSchema: {
          type: 'object',
          properties: {
            level: {
              type: 'string',
              description:
                'Filter by level: log, info, warn, error, debug. Comma-separated for multiple.',
            },
            search: {
              type: 'string',
              description: 'Filter by message content (case-insensitive substring match).',
            },
            limit: {
              type: 'number',
              description: 'Max results to return. Default: 100.',
            },
            since: {
              type: 'string',
              description: 'ISO timestamp — only return logs after this time.',
            },
          },
        },
      },
      handler: async ({
        level,
        search,
        limit = 100,
        since,
      }: {
        level?: string
        search?: string
        limit?: number
        since?: string
      } = {}) => {
        bridge.ensureConnected()
        const store = state.devtoolsStore as DevtoolsStore
        if (!store) return toolResult({ logs: [], total: 0 })

        let entries = store.console

        if (level) {
          const levels = new Set(level.split(',').map(l => l.trim().toLowerCase()))
          entries = entries.filter(e => levels.has(e.level))
        }

        if (search) {
          const lower = search.toLowerCase()
          entries = entries.filter(e => e.message.toLowerCase().includes(lower))
        }

        if (since) {
          const sinceTs = new Date(since).getTime() / 1000
          entries = entries.filter(e => e.timestamp >= sinceTs)
        }

        const total = entries.length
        const logs = entries.slice(-limit).map(e => ({
          level: e.level,
          message: e.message.length > MAX_BODY_LENGTH
            ? e.message.slice(0, MAX_BODY_LENGTH) + '...'
            : e.message,
          timestamp: new Date(e.timestamp * 1000).toISOString(),
        }))

        return toolResult({ logs, total, returned: logs.length })
      },
    },
    {
      definition: {
        name: 'electron_get_network_requests',
        description:
          'Get captured network requests from the Electron app. Captures all HTTP/HTTPS requests with status, timing, and errors.',
        inputSchema: {
          type: 'object',
          properties: {
            urlPattern: {
              type: 'string',
              description: 'Regex pattern to filter by URL.',
            },
            method: {
              type: 'string',
              description: 'HTTP method filter (e.g. GET, POST).',
            },
            errorsOnly: {
              type: 'boolean',
              description: 'Only return failed requests (4xx/5xx or network errors).',
            },
            limit: {
              type: 'number',
              description: 'Max results to return. Default: 50.',
            },
            since: {
              type: 'string',
              description: 'ISO timestamp — only return requests after this time.',
            },
            includeBody: {
              type: 'boolean',
              description: 'Include response body in output (truncated to 1KB). Default: false.',
            },
          },
        },
      },
      handler: async ({
        urlPattern,
        method,
        errorsOnly,
        limit = 50,
        since,
        includeBody = false,
      }: {
        urlPattern?: string
        method?: string
        errorsOnly?: boolean
        limit?: number
        since?: string
        includeBody?: boolean
      } = {}) => {
        bridge.ensureConnected()
        const store = state.devtoolsStore as DevtoolsStore
        if (!store) return toolResult({ requests: [], total: 0 })

        let entries = store.getNetworkEntries()

        if (urlPattern) {
          const re = new RegExp(urlPattern, 'i')
          entries = entries.filter(e => re.test(e.url))
        }

        if (method) {
          const upper = method.toUpperCase()
          entries = entries.filter(e => e.method === upper)
        }

        if (errorsOnly) {
          entries = entries.filter(e =>
            e.error || (e.status !== undefined && e.status >= 400)
          )
        }

        if (since) {
          const sinceTs = new Date(since).getTime() / 1000
          entries = entries.filter(e => e.startTime >= sinceTs)
        }

        const total = entries.length
        const requests = entries.slice(-limit).map(e => ({
          method: e.method,
          url: e.url.length > MAX_BODY_LENGTH
            ? e.url.slice(0, MAX_BODY_LENGTH) + '...'
            : e.url,
          status: e.status,
          statusText: e.statusText,
          error: e.error,
          ...(includeBody && e.body ? { body: e.body } : {}),
          duration: e.duration != null ? `${e.duration}ms` : undefined,
          timestamp: new Date(e.startTime * 1000).toISOString(),
        }))

        return toolResult({ requests, total, returned: requests.length })
      },
    },
    {
      definition: {
        name: 'electron_clear_devtools_data',
        description:
          'Clear captured console logs and/or network request buffers.',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['all', 'console', 'network', 'errors'],
              description: 'What to clear. Default: all.',
            },
          },
        },
      },
      handler: async ({ type = 'all' }: { type?: string } = {}) => {
        const store = state.devtoolsStore as DevtoolsStore
        if (!store) return toolResult({ cleared: type })

        if (type === 'console') store.clearConsole()
        else if (type === 'network') store.clearNetwork()
        else if (type === 'errors') store.clearErrors()
        else store.clearAll()

        return toolResult({ cleared: type })
      },
    },
    {
      definition: {
        name: 'electron_get_devtools_stats',
        description:
          'Get counts of captured console logs and network requests.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => {
        const store = state.devtoolsStore as DevtoolsStore
        if (!store) return toolResult({ console: 0, network: 0, errors: 0, capturing: false })

        return toolResult({
          console: store.console.length,
          network: store.network.size,
          errors: store.errors.length,
          errorGroups: store.getGroupedErrors().length,
          capturing: true,
          limits: {
            maxConsole: MAX_CONSOLE_ENTRIES,
            maxNetwork: MAX_NETWORK_ENTRIES,
            maxErrors: MAX_ERROR_ENTRIES,
          },
        })
      },
    },
    {
      definition: {
        name: 'electron_get_errors',
        description:
          'Get a Sentry-like error report: uncaught exceptions, console.error calls, and network failures — grouped by fingerprint with counts, stack traces, and first/last seen timestamps.',
        inputSchema: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description: 'Filter by source: exception, console.error, network. Comma-separated for multiple.',
            },
            search: {
              type: 'string',
              description: 'Filter by error message content (case-insensitive).',
            },
            since: {
              type: 'string',
              description: 'ISO timestamp — only return errors after this time.',
            },
            limit: {
              type: 'number',
              description: 'Max error groups to return. Default: 50.',
            },
          },
        },
      },
      handler: async ({
        source,
        search,
        since,
        limit = 50,
      }: {
        source?: string
        search?: string
        since?: string
        limit?: number
      } = {}) => {
        bridge.ensureConnected()
        const store = state.devtoolsStore as DevtoolsStore
        if (!store) return toolResult({ groups: [], totalErrors: 0, totalGroups: 0 })

        let groups = store.getGroupedErrors()

        if (source) {
          const sources = new Set(source.split(',').map(s => s.trim().toLowerCase()))
          groups = groups.filter(g => sources.has(g.source))
        }

        if (search) {
          const lower = search.toLowerCase()
          groups = groups.filter(g => g.message.toLowerCase().includes(lower))
        }

        if (since) {
          const sinceTs = new Date(since).getTime() / 1000
          groups = groups.filter(g => g.lastSeen >= sinceTs)
        }

        const totalGroups = groups.length
        const totalErrors = groups.reduce((sum, g) => sum + g.count, 0)

        const result = groups.slice(0, limit).map(g => ({
          fingerprint: g.fingerprint,
          message: g.message.length > MAX_BODY_LENGTH
            ? g.message.slice(0, MAX_BODY_LENGTH) + '...'
            : g.message,
          source: g.source,
          count: g.count,
          firstSeen: new Date(g.firstSeen * 1000).toISOString(),
          lastSeen: new Date(g.lastSeen * 1000).toISOString(),
          stack: g.stack,
          samples: g.samples,
        }))

        return toolResult({ groups: result, totalErrors, totalGroups })
      },
    },
    {
      definition: {
        name: 'electron_get_main_process_logs',
        description:
          'Get stdout/stderr output from the Electron main process (only available if launched via electron_launch). Shows main process errors, IPC handler crashes, and native module failures.',
        inputSchema: {
          type: 'object',
          properties: {
            level: {
              type: 'string',
              description: 'Filter by level: stdout, stderr. Default: both.',
            },
            search: {
              type: 'string',
              description: 'Filter by message content (case-insensitive).',
            },
            limit: {
              type: 'number',
              description: 'Max results to return. Default: 100.',
            },
            since: {
              type: 'string',
              description: 'ISO timestamp — only return logs after this time.',
            },
          },
        },
      },
      handler: async ({
        level,
        search,
        limit = 100,
        since,
      }: {
        level?: string
        search?: string
        limit?: number
        since?: string
      } = {}) => {
        let entries = state.mainProcessLogs

        if (!entries || entries.length === 0) {
          return toolResult({ logs: [], total: 0, message: 'No main process logs. Use electron_launch to start the app.' })
        }

        if (level) {
          entries = entries.filter(e => e.level === level)
        }

        if (search) {
          const lower = search.toLowerCase()
          entries = entries.filter(e => e.message.toLowerCase().includes(lower))
        }

        if (since) {
          const sinceTs = new Date(since).getTime() / 1000
          entries = entries.filter(e => e.timestamp >= sinceTs)
        }

        const total = entries.length
        const logs = entries.slice(-limit).map(e => ({
          level: e.level,
          message: e.message.length > MAX_BODY_LENGTH
            ? e.message.slice(0, MAX_BODY_LENGTH) + '...'
            : e.message,
          timestamp: new Date(e.timestamp * 1000).toISOString(),
        }))

        return toolResult({ logs, total, returned: logs.length })
      },
    },
  ]
}
