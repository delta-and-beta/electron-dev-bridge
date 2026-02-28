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
import { getCdpTools } from '../cdp-tools/index.js'
import type { ElectronMcpConfig } from '../index.js'

export async function startServer(config: ElectronMcpConfig): Promise<void> {
  const bridge = new CdpBridge(config.app.debugPort || 9229)

  // Build IPC tools from config
  const ipcTools = await buildTools(config)

  // Build CDP tools (optional)
  let cdpToolDefs: Array<{ definition: any; handler: any }> = []
  if (config.cdpTools) {
    cdpToolDefs = getCdpTools(bridge, config.app, config.screenshots)
    if (Array.isArray(config.cdpTools)) {
      const allowed = new Set(config.cdpTools)
      cdpToolDefs = cdpToolDefs.filter(t => allowed.has(t.definition.name))
    }
  }

  // Build resources
  const resources = buildResources(config)

  // Create MCP server
  const server = new Server(
    { name: config.app.name, version: '0.1.0' },
    { capabilities: {
      tools: {},
      ...(resources.length > 0 ? { resources: {} } : {}),
    }}
  )

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [
      ...ipcTools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      ...cdpToolDefs.map(t => t.definition),
    ]
    return { tools }
  })

  // Build handler lookup maps
  const ipcHandlerMap = new Map<string, ResolvedTool>()
  for (const tool of ipcTools) {
    ipcHandlerMap.set(tool.name, tool)
  }
  const cdpHandlerMap = new Map<string, (args: any) => Promise<any>>()
  for (const tool of cdpToolDefs) {
    cdpHandlerMap.set(tool.definition.name, tool.handler)
  }

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    // Check IPC tools first
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

    // Check CDP tools
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

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    }
  })

  // Register resource handlers (if any)
  if (resources.length > 0) {
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

  // Start server
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
