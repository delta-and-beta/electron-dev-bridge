# electron-mcp-sdk Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Status:** Implemented (package renamed to `electron-dev-bridge` on 2026-03-14)

**Goal:** Build an npm package (`electron-dev-bridge`, formerly `electron-mcp-sdk`) that Electron apps install to expose their IPC handlers as MCP tools, with optional CDP tools from electron-dev-bridge bundled in.

**Architecture:** Config-driven standalone MCP server connecting via CDP to Electron apps. Reads `electron-mcp.config.ts`, converts Zod schemas to JSON Schema for MCP tool definitions, routes tool calls through the app's preload bridge (`window.electronAPI.*`). CLI scaffolds config via source scanning.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `chrome-remote-interface`, `zod-to-json-schema`, `tsx` (for loading TS configs)

**Design Doc:** `docs/plans/2026-02-28-electron-mcp-sdk-design.md`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Modify: `.gitignore`

**Step 1: Create package.json**

```json
{
  "name": "electron-mcp-sdk",
  "version": "0.1.0",
  "description": "Expose Electron IPC handlers as MCP tools for Claude Code",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "electron-mcp": "dist/cli/index.js"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "node --test dist/**/*.test.js",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "chrome-remote-interface": "^0.33.2",
    "zod-to-json-schema": "^3.24.5",
    "tsx": "^4.19.0"
  },
  "peerDependencies": {
    "zod": "^3.0.0"
  },
  "peerDependenciesMeta": {
    "zod": { "optional": true }
  },
  "engines": {
    "node": ">=18"
  },
  "files": ["dist", "templates"],
  "license": "MIT"
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Update .gitignore**

Add `dist/` and `node_modules/` to the project-root `.gitignore` (currently only has `scripts/node_modules`).

**Step 4: Install dependencies**

Run: `npm install`

**Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit` (should succeed with zero source files)

**Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore
git commit -m "feat: scaffold electron-mcp-sdk package"
```

---

## Task 2: Public API — `defineConfig` and Types

**Files:**
- Create: `src/index.ts`

**Step 1: Write defineConfig and all types**

This is the public API surface. Users import `defineConfig` from `electron-mcp-sdk` for config IntelliSense.

```typescript
// src/index.ts

import type { ZodType } from 'zod'

/** Configuration for an IPC tool */
export interface ToolConfig {
  /** Description shown to Claude */
  description: string
  /** Zod schema for input validation and JSON Schema generation */
  schema?: ZodType<any>
  /** Override the auto-derived preload path (e.g., 'window.electronAPI.crawl.startJob') */
  preloadPath?: string
  /** Hint describing the return shape (shown in tool description) */
  returns?: string
}

/** Configuration for an MCP resource (event-backed) */
export interface ResourceConfig {
  /** Description shown to Claude */
  description: string
  /** MCP resource URI (e.g., 'electron://crawl/progress') */
  uri: string
  /** JS expression evaluated via CDP to poll for data */
  pollExpression: string
}

/** App connection configuration */
export interface AppConfig {
  /** MCP server display name */
  name: string
  /** Path to the Electron app directory */
  path?: string
  /** CDP debugging port (default: 9229) */
  debugPort?: number
  /** Path to the Electron binary (auto-resolved from app path if omitted) */
  electronBin?: string
}

/** Screenshot configuration */
export interface ScreenshotConfig {
  /** Directory to save screenshots (default: '.screenshots') */
  dir?: string
  /** Image format (default: 'png') */
  format?: 'png' | 'jpeg'
}

/** Full SDK configuration */
export interface ElectronMcpConfig {
  /** App connection settings */
  app: AppConfig
  /** IPC channel -> MCP tool mappings */
  tools: Record<string, ToolConfig>
  /** IPC event -> MCP resource mappings */
  resources?: Record<string, ResourceConfig>
  /** Enable CDP tools from electron-dev-bridge (true = all, string[] = selective) */
  cdpTools?: boolean | string[]
  /** Screenshot settings */
  screenshots?: ScreenshotConfig
}

/** Type-safe config helper */
export function defineConfig(config: ElectronMcpConfig): ElectronMcpConfig {
  return config
}
```

**Step 2: Verify it compiles**

Run: `npx tsc`
Expected: `dist/index.js` and `dist/index.d.ts` created

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add defineConfig public API and types"
```

---

## Task 3: CDP Bridge Module

**Files:**
- Create: `src/server/cdp-bridge.ts`

**Step 1: Write the CDP bridge**

Port the CDP connection logic from `scripts/mcp-server.js` (lines 56-145) into a clean TypeScript class.

```typescript
// src/server/cdp-bridge.ts

import CDP from 'chrome-remote-interface'

export class CdpBridge {
  private client: CDP.Client | null = null
  private port: number

  constructor(port: number = 9229) {
    this.port = port
  }

  get connected(): boolean {
    return this.client !== null
  }

  /** Connect to a running Electron app via CDP with retries */
  async connect(maxRetries = 10): Promise<void> {
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const targets = await CDP.List({ port: this.port })
        const page = targets.find((t: any) => t.type === 'page')
        if (!page) throw new Error('No page target found among CDP targets')

        this.client = await CDP({ target: page, port: this.port })
        await this.client.Runtime.enable()
        await this.client.DOM.enable()
        await this.client.Page.enable()
        await this.client.Network.enable()

        this.client.on('disconnect', () => { this.client = null })
        return
      } catch (err) {
        lastError = err as Error
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000))
        }
      }
    }

    throw new Error(
      `Cannot connect to Electron app on port ${this.port} after ${maxRetries} attempts. ` +
      `Is the app running with --remote-debugging-port=${this.port}? ` +
      `(${lastError?.message})`
    )
  }

  /** Ensure CDP is connected, throw if not */
  ensureConnected(): void {
    if (!this.client) {
      throw new Error(
        'Not connected to an Electron app. ' +
        'Start the app with --remote-debugging-port and use the connect tool first.'
      )
    }
  }

  /** Evaluate a JS expression in the connected Electron renderer */
  async evaluate(expression: string, awaitPromise = true): Promise<any> {
    this.ensureConnected()

    const { result, exceptionDetails } = await this.client!.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise,
    })

    if (exceptionDetails) {
      const errText =
        exceptionDetails.exception?.description ||
        exceptionDetails.text ||
        'Unknown evaluation error'
      throw new Error(`JS evaluation error: ${errText}`)
    }

    return result.value
  }

  /** Get the raw CDP client for advanced operations (screenshots, DOM, etc.) */
  getRawClient(): any {
    this.ensureConnected()
    return this.client!
  }

  /** Close the CDP connection */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
    }
  }
}
```

**Step 2: Verify it compiles**

Run: `npx tsc`
Expected: clean compile

**Step 3: Commit**

```bash
git add src/server/cdp-bridge.ts
git commit -m "feat: add CDP bridge module with retry logic"
```

---

## Task 4: Tool Builder — Config to MCP Tool Definitions

**Files:**
- Create: `src/server/tool-builder.ts`

**Step 1: Write the tool builder**

Converts the `tools` config map into MCP tool definitions. Handles:
- Zod schema to JSON Schema conversion
- Auto-deriving preload paths from channel names
- Building the description with optional `returns` hint

```typescript
// src/server/tool-builder.ts

import type { ElectronMcpConfig } from '../index.js'

/** Resolved tool ready for MCP registration */
export interface ResolvedTool {
  /** MCP tool name (channel with colons replaced by underscores) */
  name: string
  /** MCP tool description */
  description: string
  /** JSON Schema for inputSchema */
  inputSchema: Record<string, any>
  /** The IPC channel name (e.g., 'profiles:query') */
  channel: string
  /** JS expression to call via CDP (e.g., 'window.electronAPI.profiles.query') */
  preloadPath: string
}

/**
 * Convert a channel name to an MCP tool name.
 * 'profiles:query' -> 'profiles_query'
 */
function channelToToolName(channel: string): string {
  return channel.replace(/:/g, '_')
}

/**
 * Auto-derive the preload path from a channel name.
 * 'profiles:query' -> 'window.electronAPI.profiles.query'
 * 'crawl:start'    -> 'window.electronAPI.crawl.start'
 */
function channelToPreloadPath(channel: string): string {
  const [domain, action] = channel.split(':')
  return `window.electronAPI.${domain}.${action}`
}

/**
 * Convert a Zod schema to JSON Schema.
 * Uses zod-to-json-schema if available, falls back to permissive schema.
 */
async function zodToJsonSchema(schema: any): Promise<Record<string, any>> {
  try {
    const { zodToJsonSchema: convert } = await import('zod-to-json-schema')
    const jsonSchema = convert(schema, { target: 'openApi3' })
    const { $schema, ...rest } = jsonSchema as any
    return rest
  } catch {
    return { type: 'object' }
  }
}

/**
 * Build resolved MCP tools from the config's tools map.
 */
export async function buildTools(config: ElectronMcpConfig): Promise<ResolvedTool[]> {
  const tools: ResolvedTool[] = []

  for (const [channel, toolConfig] of Object.entries(config.tools)) {
    let inputSchema: Record<string, any> = { type: 'object' }

    if (toolConfig.schema) {
      inputSchema = await zodToJsonSchema(toolConfig.schema)
    }

    let description = toolConfig.description
    if (toolConfig.returns) {
      description += ` Returns: ${toolConfig.returns}`
    }

    tools.push({
      name: channelToToolName(channel),
      description,
      inputSchema,
      channel,
      preloadPath: toolConfig.preloadPath || channelToPreloadPath(channel),
    })
  }

  return tools
}
```

**Step 2: Verify it compiles**

Run: `npx tsc`
Expected: clean compile

**Step 3: Commit**

```bash
git add src/server/tool-builder.ts
git commit -m "feat: add tool builder with Zod-to-JSON-Schema conversion"
```

---

## Task 5: Resource Builder — Config to MCP Resources

**Files:**
- Create: `src/server/resource-builder.ts`

**Step 1: Write the resource builder**

Converts the `resources` config map into MCP resource definitions.

```typescript
// src/server/resource-builder.ts

import type { ElectronMcpConfig } from '../index.js'

/** Resolved resource ready for MCP registration */
export interface ResolvedResource {
  /** MCP resource URI (e.g., 'electron://crawl/progress') */
  uri: string
  /** Resource display name */
  name: string
  /** Resource description */
  description: string
  /** JS expression to evaluate via CDP for polling */
  pollExpression: string
  /** MIME type for the resource */
  mimeType: string
}

/**
 * Build resolved MCP resources from the config's resources map.
 */
export function buildResources(config: ElectronMcpConfig): ResolvedResource[] {
  if (!config.resources) return []

  const resources: ResolvedResource[] = []

  for (const [channel, resourceConfig] of Object.entries(config.resources)) {
    resources.push({
      uri: resourceConfig.uri,
      name: channel,
      description: resourceConfig.description,
      pollExpression: resourceConfig.pollExpression,
      mimeType: 'application/json',
    })
  }

  return resources
}
```

**Step 2: Verify it compiles**

Run: `npx tsc`

**Step 3: Commit**

```bash
git add src/server/resource-builder.ts
git commit -m "feat: add resource builder for MCP resource definitions"
```

---

## Task 6: CDP Tools Module — Port from electron-dev-bridge

**Files:**
- Create: `src/cdp-tools/index.ts`

**Step 1: Port all 22 CDP tools from `scripts/mcp-server.js`**

Extract the 22 `registerTool()` calls from `scripts/mcp-server.js` (lines 186-1336) into a self-contained module. Each tool becomes a factory function that accepts a `CdpBridge` instance.

The module exports a function `getCdpTools(bridge: CdpBridge): Array<{ definition, handler }>` that returns all 22 tool definitions and their handlers bound to the bridge.

Tools to port (grouped by category):
- **Connection (2):** `electron_launch`, `electron_connect`
- **DOM Queries (5):** `electron_query_selector`, `electron_query_selector_all`, `electron_get_accessibility_tree`, `electron_find_by_text`, `electron_get_bounding_box`
- **Interactions (4):** `electron_click`, `electron_type`, `electron_select_option`, `electron_highlight`
- **Reading State (5):** `electron_get_url`, `electron_get_title`, `electron_get_html`, `electron_evaluate_js`, `electron_get_computed_styles`
- **Navigation (3):** `electron_navigate`, `electron_scroll`, `electron_wait_for_selector`
- **Screenshots (3):** `electron_screenshot`, `electron_set_viewport`, `electron_compare_screenshots`

The implementation should reuse `CdpBridge.evaluate()` and `CdpBridge.getRawClient()` instead of the original bare `evaluateJS()` and `cdpClient` globals.

Key structure:

```typescript
// src/cdp-tools/index.ts

import { CdpBridge } from '../server/cdp-bridge.js'
import type { AppConfig, ScreenshotConfig } from '../index.js'

interface CdpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
}

interface CdpTool {
  definition: CdpToolDefinition
  handler: (args: any) => Promise<any>
}

export function getCdpTools(
  bridge: CdpBridge,
  appConfig: AppConfig,
  screenshotConfig?: ScreenshotConfig
): CdpTool[] {
  const tools: CdpTool[] = []
  const screenshotDir = screenshotConfig?.dir || '.screenshots'
  const screenshotFormat = screenshotConfig?.format || 'png'

  // Helper to format tool results
  function toolResult(data: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
  function toolError(message: string) {
    return { content: [{ type: 'text' as const, text: 'Error: ' + message }], isError: true }
  }

  // Port each of the 22 tools here.
  // Each tool uses bridge.evaluate() instead of evaluateJS()
  // and bridge.getRawClient() instead of cdpClient
  // Reference: scripts/mcp-server.js lines 186-1336

  return tools
}
```

Port each tool from `scripts/mcp-server.js` line by line, replacing:
- `evaluateJS(expr)` with `bridge.evaluate(expr)`
- `cdpClient.X.Y()` with `bridge.getRawClient().X.Y()`
- `ensureConnected()` with `bridge.ensureConnected()`
- Global `screenshotCounter` with local state within the closure

**Step 2: Verify it compiles**

Run: `npx tsc`

**Step 3: Commit**

```bash
git add src/cdp-tools/index.ts
git commit -m "feat: port 22 CDP tools from electron-dev-bridge"
```

---

## Task 7: Core MCP Server

**Files:**
- Create: `src/server/mcp-server.ts`

**Step 1: Write the MCP server**

This is the central module that ties everything together. It:
1. Loads the config
2. Builds IPC tool definitions
3. Optionally loads CDP tools
4. Builds MCP resources
5. Starts the stdio MCP server

```typescript
// src/server/mcp-server.ts

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
```

**Step 2: Verify it compiles**

Run: `npx tsc`

**Step 3: Commit**

```bash
git add src/server/mcp-server.ts
git commit -m "feat: add core MCP server with IPC/CDP tool routing"
```

---

## Task 8: CLI — `serve` Command

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/serve.ts`

**Step 1: Write the serve command**

The `serve` command loads the config file using `tsx` (to handle TypeScript imports) and starts the MCP server.

```typescript
// src/cli/serve.ts

import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { startServer } from '../server/mcp-server.js'
import type { ElectronMcpConfig } from '../index.js'

const CONFIG_NAMES = [
  'electron-mcp.config.ts',
  'electron-mcp.config.js',
  'electron-mcp.config.mjs',
]

export async function serve(configPath?: string): Promise<void> {
  let resolvedPath: string | undefined

  if (configPath) {
    resolvedPath = resolve(configPath)
  } else {
    for (const name of CONFIG_NAMES) {
      const candidate = resolve(name)
      if (existsSync(candidate)) {
        resolvedPath = candidate
        break
      }
    }
  }

  if (!resolvedPath || !existsSync(resolvedPath)) {
    console.error(
      'Error: No config file found. Create electron-mcp.config.ts or run: npx electron-mcp init'
    )
    process.exit(1)
  }

  // Load config using dynamic import (tsx handles TS transpilation)
  const mod = await import(resolvedPath)
  const config: ElectronMcpConfig = mod.default

  if (!config || !config.app || !config.tools) {
    console.error('Error: Invalid config. Must export default defineConfig({ app, tools })')
    process.exit(1)
  }

  await startServer(config)
}
```

```typescript
// src/cli/index.ts
#!/usr/bin/env node

const command = process.argv[2]

switch (command) {
  case 'serve':
  case undefined: {
    const configPath = process.argv[3]
    const { serve } = await import('./serve.js')
    await serve(configPath)
    break
  }
  case 'init': {
    const { init } = await import('./init.js')
    await init()
    break
  }
  case 'register': {
    const { register } = await import('./register.js')
    await register()
    break
  }
  case 'validate': {
    const { validate } = await import('./validate.js')
    await validate()
    break
  }
  default:
    console.log(`electron-mcp-sdk v0.1.0

Commands:
  serve [config]    Start the MCP server (default)
  init              Scaffold a config file from source code
  register          Register with Claude Code
  validate          Validate config and check readiness

Usage:
  npx electron-mcp serve
  npx electron-mcp init
  npx electron-mcp register
  npx electron-mcp validate`)
    break
}
```

**Step 2: Create placeholder files for init, register, validate**

So the CLI compiles before those commands are implemented:

```typescript
// src/cli/init.ts
export async function init() { console.log('TODO: init') }

// src/cli/register.ts
export async function register() { console.log('TODO: register') }

// src/cli/validate.ts
export async function validate() { console.log('TODO: validate') }
```

**Step 3: Verify it compiles**

Run: `npx tsc`

**Step 4: Commit**

```bash
git add src/cli/
git commit -m "feat: add CLI with serve command and config loading"
```

---

## Task 9: CLI — `init` Command (Source Scanner)

**Files:**
- Create: `src/scanner/ipc-scanner.ts`
- Create: `src/scanner/schema-scanner.ts`
- Modify: `src/cli/init.ts`

**Step 1: Write the IPC scanner**

Scans source files for `ipcMain.handle('channel', ...)` patterns using regex.

```typescript
// src/scanner/ipc-scanner.ts

import { readFileSync } from 'node:fs'

export interface DetectedHandler {
  channel: string
  line: number
  file: string
}

/**
 * Scan a file for ipcMain.handle() calls and extract channel names.
 */
export function scanForHandlers(filePath: string): DetectedHandler[] {
  const content = readFileSync(filePath, 'utf-8')
  const handlers: DetectedHandler[] = []
  const regex = /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const channel = match[1]
    const upToMatch = content.slice(0, match.index)
    const line = upToMatch.split('\n').length
    handlers.push({ channel, line, file: filePath })
  }

  return handlers
}
```

**Step 2: Write the schema scanner**

```typescript
// src/scanner/schema-scanner.ts

import { readFileSync } from 'node:fs'

export interface DetectedSchema {
  name: string
  line: number
  file: string
}

/**
 * Scan a file for exported Zod schema declarations.
 */
export function scanForSchemas(filePath: string): DetectedSchema[] {
  const content = readFileSync(filePath, 'utf-8')
  const schemas: DetectedSchema[] = []
  const regex = /export\s+const\s+(\w+Schema)\s*=\s*z\./g
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const name = match[1]
    const upToMatch = content.slice(0, match.index)
    const line = upToMatch.split('\n').length
    schemas.push({ name, line, file: filePath })
  }

  return schemas
}
```

**Step 3: Implement the init command**

Update `src/cli/init.ts` with the full implementation that:
1. Finds all TS/JS files in the project (excluding node_modules, dist, .git)
2. Scans for `ipcMain.handle()` calls using `scanForHandlers()`
3. Scans for Zod schema exports using `scanForSchemas()`
4. Matches schemas to channels by name heuristic (e.g., `profileQuerySchema` matches `profiles:query`)
5. Generates `electron-mcp.config.ts` with all discovered tools and schema imports
6. Auto-derives descriptions from channel names (e.g., `profiles:query` becomes `Query Profiles`)

The implementation uses `readFileSync`, `writeFileSync`, `existsSync`, `readdirSync`, `statSync` from `node:fs` and `resolve`, `join`, `relative`, `basename` from `node:path`.

**Step 4: Verify it compiles**

Run: `npx tsc`

**Step 5: Commit**

```bash
git add src/scanner/ src/cli/init.ts
git commit -m "feat: add init command with IPC/schema source scanning"
```

---

## Task 10: CLI — `register` Command

**Files:**
- Modify: `src/cli/register.ts`

**Step 1: Implement register**

Uses `execFileSync` from `node:child_process` to safely run `claude mcp add --scope user <name> -- npx electron-mcp serve`. Extracts the app name from config via regex (no need to load full TS config). Uses `execFileSync('claude', ['mcp', 'add', ...])` instead of `execSync` to prevent command injection.

**Step 2: Verify it compiles**

Run: `npx tsc`

**Step 3: Commit**

```bash
git add src/cli/register.ts
git commit -m "feat: add register command for Claude Code integration"
```

---

## Task 11: CLI — `validate` Command

**Files:**
- Modify: `src/cli/validate.ts`

**Step 1: Implement validate**

Loads the config via dynamic import, then validates:
- `app.name` is present
- Tool count and schema count
- Resource count
- CDP tools status (enabled/disabled, selective count)
- Reports any preload path overrides as warnings
- Prints total MCP tool count

**Step 2: Verify it compiles**

Run: `npx tsc`

**Step 3: Commit**

```bash
git add src/cli/validate.ts
git commit -m "feat: add validate command for config checking"
```

---

## Task 12: Integration Tests

**Files:**
- Create: `tests/integration.test.ts`

**Step 1: Write integration tests**

Uses `node:test` (built-in test runner). Tests:

1. **tool-builder**: Converts config tools to MCP definitions, verifies tool naming (`profiles:query` becomes `profiles_query`), preload path derivation, description appending with `returns`, preload path override.

2. **resource-builder**: Converts config resources to MCP resources, verifies URI/name/mimeType. Returns empty array when no resources configured.

3. **scanner**: Points at the actual linkedin-app source files to verify real-world detection:
   - `scanForHandlers()` on `linkedin-app/src/main/index.ts` finds 30+ handlers
   - `scanForSchemas()` on `linkedin-app/src/main/ipc-schemas.ts` finds 4+ schemas

**Step 2: Build and run tests**

Run: `npx tsc && node --test dist/tests/integration.test.js`
Expected: All tests pass

**Step 3: Commit**

```bash
git add tests/
git commit -m "test: add integration tests for tool/resource builders and scanners"
```

---

## Task 13: Example Config for linkedin-app

**Files:**
- Create: `examples/linkedin-app-config.ts`

**Step 1: Write the example config**

Create a complete, working config file for the linkedin-app with all 38 IPC handlers mapped as tools, including:
- Proper `preloadPath` overrides where the auto-derived path differs from the preload (e.g., `crawl:start` maps to `crawl.startJob`)
- Schema comments showing where Zod schemas would be imported
- `returns` hints for tools that return data
- Two resources for crawl progress and session status
- CDP tools enabled

**Step 2: Commit**

```bash
git add examples/linkedin-app-config.ts
git commit -m "docs: add complete example config for linkedin-app"
```

---

## Task 14: Build Verification & npm Pack Test

**Files:** (none created -- verification only)

**Step 1: Clean build**

Run: `rm -rf dist && npx tsc`
Expected: clean compile, all `.js` and `.d.ts` files in `dist/`

**Step 2: Verify CLI runs**

Run: `node dist/cli/index.js --help`
Expected: help text displayed

**Step 3: Verify npm pack**

Run: `npm pack --dry-run`
Expected: lists files that would be included in the tarball (dist/, templates/)

**Step 4: Verify all tests pass**

Run: `node --test dist/tests/integration.test.js`
Expected: all tests pass

**Step 5: Commit any fixes from verification**

```bash
git add -A
git commit -m "chore: verification fixes"
```

---

## Task 15: Update SKILL.md

**Files:**
- Modify: `SKILL.md`

**Step 1: Update SKILL.md**

Add an "SDK Mode" section to the existing SKILL.md that documents:
- When to use SDK mode vs standalone CDP mode
- Quick start: `npm install electron-mcp-sdk && npx electron-mcp init && npx electron-mcp register`
- Config file reference (link to `examples/linkedin-app-config.ts`)
- IPC tool naming convention (`domain:action` becomes `domain_action`)
- Resource polling pattern

Keep the existing CDP-only content intact. The SDK section is additive.

**Step 2: Commit**

```bash
git add SKILL.md
git commit -m "docs: add SDK mode section to SKILL.md"
```

---

## Summary

| Task | Description | Key Files | Depends On |
|------|-------------|-----------|------------|
| 1 | Project scaffolding | package.json, tsconfig.json | -- |
| 2 | Public API and types | src/index.ts | 1 |
| 3 | CDP bridge module | src/server/cdp-bridge.ts | 2 |
| 4 | Tool builder | src/server/tool-builder.ts | 2 |
| 5 | Resource builder | src/server/resource-builder.ts | 2 |
| 6 | CDP tools port | src/cdp-tools/index.ts | 3 |
| 7 | Core MCP server | src/server/mcp-server.ts | 3, 4, 5, 6 |
| 8 | CLI serve command | src/cli/index.ts, src/cli/serve.ts | 7 |
| 9 | CLI init + scanners | src/scanner/, src/cli/init.ts | 2 |
| 10 | CLI register | src/cli/register.ts | 8 |
| 11 | CLI validate | src/cli/validate.ts | 2 |
| 12 | Integration tests | tests/integration.test.ts | 4, 5, 9 |
| 13 | Example config | examples/linkedin-app-config.ts | 2 |
| 14 | Build verification | -- | all |
| 15 | SKILL.md update | SKILL.md | all |
