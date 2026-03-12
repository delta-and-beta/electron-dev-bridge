import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

import type { CdpTool, ToolContext } from './types.js'
import { toolResult } from './helpers.js'

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
                'Path to the Electron app directory. Defaults to ELECTRON_APP_PATH env var.',
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
        const defaultAppPath = appConfig.path || ''
        const resolvedAppPath = resolve(appPath || defaultAppPath)
        if (!resolvedAppPath) {
          throw new Error(
            'No app path provided. Pass appPath or set ELECTRON_APP_PATH env var.',
          )
        }

        const debugPort = appConfig.debugPort || 9229
        const electronBin =
          appConfig.electronBin || join(resolvedAppPath, 'node_modules', '.bin', 'electron')

        const child = spawn(
          electronBin,
          [`--remote-debugging-port=${debugPort}`, resolvedAppPath, ...args],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        )

        state.electronProcess = child

        const stderrChunks: string[] = []
        child.stderr!.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString()))

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

        await bridge.connect()

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
                'CDP debugging port. Defaults to ELECTRON_DEBUG_PORT env var or 9229.',
            },
          },
        },
      },
      handler: async ({ port }: { port?: number } = {}) => {
        const targetPort = port || appConfig.debugPort || 9229
        bridge.setPort(targetPort)
        await bridge.connect()
        return toolResult({ connected: true, port: targetPort })
      },
    },
  ]
}
