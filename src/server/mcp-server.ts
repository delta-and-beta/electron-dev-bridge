import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { CdpBridge } from './cdp-bridge.js'
import { buildTools, type ResolvedTool } from './tool-builder.js'
import { buildResources, type ResolvedResource } from './resource-builder.js'
import { getCdpTools, type CdpTool } from '../cdp-tools/index.js'
import type { ElectronMcpConfig, CustomTool } from '../index.js'

function registerToolHandlers(
  server: Server,
  bridge: CdpBridge,
  ipcTools: ResolvedTool[],
  cdpToolDefs: CdpTool[],
  customTools: CustomTool[],
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...ipcTools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      ...cdpToolDefs.map(t => t.definition),
      ...customTools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    ],
  }))

  const ipcHandlerMap = new Map<string, ResolvedTool>()
  for (const tool of ipcTools) {
    ipcHandlerMap.set(tool.name, tool)
  }
  const cdpHandlerMap = new Map<string, (args: any) => Promise<any>>()
  for (const tool of cdpToolDefs) {
    cdpHandlerMap.set(tool.definition.name, tool.handler)
  }
  const customHandlerMap = new Map<string, CustomTool>()
  for (const tool of customTools) {
    customHandlerMap.set(tool.name, tool)
  }

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    const ipcTool = ipcHandlerMap.get(name)
    if (ipcTool) {
      try {
        const argsJson = args && Object.keys(args).length > 0
          ? JSON.stringify(args)
          : ''
        const expression = argsJson
          ? `${ipcTool.preloadPath}(${argsJson})`
          : `${ipcTool.preloadPath}()`

        const result = await bridge.evaluate(expression, true)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        }
      }
    }

    const cdpHandler = cdpHandlerMap.get(name)
    if (cdpHandler) {
      try {
        return await cdpHandler(args || {})
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        }
      }
    }

    const customTool = customHandlerMap.get(name)
    if (customTool) {
      try {
        return await customTool.handler((args || {}) as Record<string, unknown>)
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        }
      }
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    }
  })
}

function registerResourceHandlers(
  server: Server,
  bridge: CdpBridge,
  resources: ResolvedResource[],
): void {
  if (resources.length === 0) return

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map(r => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(r => r.uri === request.params.uri)
    if (!resource) {
      throw new Error(`Unknown resource: ${request.params.uri}`)
    }

    try {
      const data = await bridge.evaluate(resource.pollExpression, true)
      return {
        contents: [{
          uri: resource.uri,
          mimeType: resource.mimeType,
          text: JSON.stringify(data, null, 2),
        }],
      }
    } catch (err: any) {
      throw new Error(`Failed to read resource ${resource.uri}: ${err.message}`)
    }
  })
}

export async function startServer(config: ElectronMcpConfig): Promise<void> {
  const bridge = new CdpBridge(config.app.debugPort || 9229)

  const ipcTools = await buildTools(config)

  let cdpToolDefs: CdpTool[] = []
  if (config.cdpTools) {
    cdpToolDefs = getCdpTools(bridge, config.app, config.screenshots)
    if (Array.isArray(config.cdpTools)) {
      const allowed = new Set(config.cdpTools)
      cdpToolDefs = cdpToolDefs.filter(t => allowed.has(t.definition.name))
    }
  }

  const resources = buildResources(config)

  const server = new Server(
    { name: config.app.name, version: '0.1.0' },
    { capabilities: {
      tools: {},
      ...(resources.length > 0 ? { resources: {} } : {}),
    }}
  )

  const customTools = config.customTools || []
  registerToolHandlers(server, bridge, ipcTools, cdpToolDefs, customTools)
  registerResourceHandlers(server, bridge, resources)

  const cleanup = async () => {
    await bridge.close()
    await server.close()
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
