import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

import type { CdpTool, ToolContext } from './types.js'
import { DevtoolsStore } from './devtools.js'
import { toolResult } from './helpers.js'

function getAvailablePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(preferred || 0, () => {
      const port = (srv.address() as any).port
      srv.close(() => resolve(port))
    })
    srv.on('error', () => {
      if (preferred) {
        // Preferred port occupied — fall back to random
        const fallback = createServer()
        fallback.listen(0, () => {
          const port = (fallback.address() as any).port
          fallback.close(() => resolve(port))
        })
        fallback.on('error', reject)
      } else {
        reject(new Error('Failed to allocate a port'))
      }
    })
  })
}

function attachDevtoolsStore(bridge: any, state: ToolContext['state']): void {
  if (state.devtoolsStore) {
    state.devtoolsStore.detach()
  }
  const store = new DevtoolsStore()
  store.attach(bridge.getRawClient())
  state.devtoolsStore = store
}

export function createLifecycleTools(ctx: ToolContext): CdpTool[] {
  const { bridge, appConfig, state } = ctx

  return [
    {
      definition: {
        name: 'electron_launch',
        description:
          'Launch an Electron application with remote debugging enabled and connect to it via CDP.',
        inputSchema: {
          type: 'object',
          properties: {
            appPath: {
              type: 'string',
              description:
                'Path to the Electron app directory. Defaults to the path set in the SDK config.',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional command-line arguments to pass to Electron.',
            },
          },
        },
      },
      handler: async ({ appPath, args = [] }: { appPath?: string; args?: string[] } = {}) => {
        const rawPath = appPath || appConfig.path
        if (!rawPath) {
          throw new Error(
            'No app path provided. Pass appPath or set app.path in your config.',
          )
        }
        const resolvedAppPath = resolve(rawPath)

        const debugPort = await getAvailablePort(appConfig.debugPort)
        const electronBin =
          appConfig.electronBin || join(resolvedAppPath, 'node_modules', '.bin', 'electron')

        const child = spawn(
          electronBin,
          [`--remote-debugging-port=${debugPort}`, resolvedAppPath, ...args],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        )

        state.electronProcess = child
        state.mainProcessLogs = []

        const stderrChunks: string[] = []
        child.stdout!.on('data', (chunk: Buffer) => {
          const msg = chunk.toString().trim()
          if (msg) state.mainProcessLogs.push({ level: 'stdout', message: msg, timestamp: Date.now() / 1000 })
        })
        child.stderr!.on('data', (chunk: Buffer) => {
          const msg = chunk.toString().trim()
          stderrChunks.push(msg)
          if (msg) state.mainProcessLogs.push({ level: 'stderr', message: msg, timestamp: Date.now() / 1000 })
        })

        child.on('exit', () => {
          state.electronProcess = null
        })

        await new Promise(r => setTimeout(r, 2000))

        if (child.exitCode !== null) {
          throw new Error(
            `Electron process exited immediately with code ${child.exitCode}. ` +
              `stderr: ${stderrChunks.join('')}. ` +
              'Check that the app path is correct and Electron is installed.',
          )
        }

        bridge.setPort(debugPort)
        await bridge.connect()
        attachDevtoolsStore(bridge, state)

        return toolResult({
          pid: child.pid,
          debugPort,
          connected: true,
          stderr: stderrChunks.join(''),
        })
      },
    },
    {
      definition: {
        name: 'electron_connect',
        description:
          'Connect to an already-running Electron app via Chrome DevTools Protocol.',
        inputSchema: {
          type: 'object',
          properties: {
            port: {
              type: 'number',
              description:
                'CDP debugging port. Defaults to app.debugPort in config or 9229.',
            },
          },
        },
      },
      handler: async ({ port }: { port?: number } = {}) => {
        const targetPort = port || appConfig.debugPort || 9229
        if (bridge.connected) {
          return toolResult({ connected: true, port: targetPort, message: 'Already connected' })
        }
        bridge.setPort(targetPort)
        await bridge.connect()
        attachDevtoolsStore(bridge, state)
        return toolResult({ connected: true, port: targetPort })
      },
    },
    {
      definition: {
        name: 'electron_list_targets',
        description:
          'List all available page targets (BrowserWindows) in the Electron app. Use to discover multiple windows before switching.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => {
        const targets = await bridge.listTargets()
        return toolResult({ targets, count: targets.length })
      },
    },
    {
      definition: {
        name: 'electron_switch_target',
        description:
          'Switch the CDP connection to a different page target (BrowserWindow). Use electron_list_targets first to see available targets.',
        inputSchema: {
          type: 'object',
          properties: {
            targetId: {
              type: 'string',
              description: 'Target ID from electron_list_targets.',
            },
            urlPattern: {
              type: 'string',
              description: 'Regex pattern to match target URL. Used instead of targetId.',
            },
          },
        },
      },
      handler: async ({
        targetId,
        urlPattern,
      }: {
        targetId?: string
        urlPattern?: string
      } = {}) => {
        if (!targetId && !urlPattern) {
          throw new Error('Provide either targetId or urlPattern.')
        }

        if (urlPattern) {
          const targets = await bridge.listTargets()
          const re = new RegExp(urlPattern, 'i')
          const match = targets.find(t => re.test(t.url))
          if (!match) {
            throw new Error(`No target matching URL pattern: ${urlPattern}`)
          }
          targetId = match.id
        }

        await bridge.connectToTarget(targetId!)
        attachDevtoolsStore(bridge, state)

        const url = await bridge.evaluate('window.location.href')
        const title = await bridge.evaluate('document.title')
        return toolResult({ switched: true, targetId, url, title })
      },
    },
  ]
}
