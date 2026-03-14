import type { CdpTool, ToolContext } from './types.js'
import { toolResult } from './helpers.js'

const MAX_CONSOLE_ENTRIES = 1000
const MAX_NETWORK_ENTRIES = 500
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
  startTime: number
  endTime?: number
  duration?: number
}

export class DevtoolsStore {
  console: ConsoleEntry[] = []
  network: Map<string, NetworkEntry> = new Map()
  pendingRequests: Set<string> = new Set()
  private attached = false

  attach(client: any): void {
    if (this.attached) return
    this.attached = true

    client.Runtime.consoleAPICalled(({ type, args, timestamp }: any) => {
      const message = (args || [])
        .map((a: any) => a.value ?? a.description ?? String(a.type))
        .join(' ')

      this.console.push({ level: type, message, timestamp })

      if (this.console.length > MAX_CONSOLE_ENTRIES) {
        this.console.splice(0, this.console.length - MAX_CONSOLE_ENTRIES)
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
      }
    })

    client.Network.loadingFailed(({ requestId, errorText }: any) => {
      this.pendingRequests.delete(requestId)
      const entry = this.network.get(requestId)
      if (entry) {
        entry.error = errorText
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

  clearAll(): void {
    this.clearConsole()
    this.clearNetwork()
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
          },
        },
      },
      handler: async ({
        urlPattern,
        method,
        errorsOnly,
        limit = 50,
        since,
      }: {
        urlPattern?: string
        method?: string
        errorsOnly?: boolean
        limit?: number
        since?: string
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
              enum: ['all', 'console', 'network'],
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
        if (!store) return toolResult({ console: 0, network: 0, capturing: false })

        return toolResult({
          console: store.console.length,
          network: store.network.size,
          capturing: true,
          limits: {
            maxConsole: MAX_CONSOLE_ENTRIES,
            maxNetwork: MAX_NETWORK_ENTRIES,
          },
        })
      },
    },
  ]
}
