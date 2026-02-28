# electron-mcp-sdk Design Document

**Date:** 2026-02-28
**Status:** Approved

## Overview

An npm package that Electron apps install to automatically expose their internal services (IPC handlers, events, state) as MCP tools for Claude Code. The SDK complements electron-dev-bridge by adding app-specific IPC tools alongside the existing generic CDP tools.

## Architecture

### System Topology

```
┌─────────────┐    stdio     ┌──────────────────────┐     CDP      ┌─────────────────┐
│ Claude Code │◄────────────►│  electron-mcp-sdk    │◄───────────►│  Electron App   │
│             │              │  (standalone process) │  WebSocket  │  (unchanged)    │
└─────────────┘              └──────────────────────┘             └─────────────────┘
```

- **MCP server** runs as a standalone Node process (not embedded in Electron)
- Connects to the Electron app via Chrome DevTools Protocol (CDP)
- Routes tool calls through the app's existing preload bridge (`window.electronAPI.*`)
- The Electron app requires zero runtime modifications

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Complement electron-dev-bridge | IPC tools for app-specific features; CDP tools bundled as optional add-on |
| Discovery | Explicit config file | Zero magic, reliable across all codebase structures |
| Architecture | Standalone process | App stays untouched at runtime |
| Install UX | npm package + CLI scaffold | `npx electron-mcp init` auto-detects IPC channels |
| Events | MCP resources | IPC events become pollable resources |
| Core approach | Config-driven tool generation | Config read at startup, tools generated dynamically |

## Tool Call Flow

1. Claude sends MCP `tools/call` for `profiles_query` with `{ search: "engineer" }`
2. MCP server looks up tool in config → maps to IPC channel `profiles:query`
3. Server calls CDP `Runtime.evaluate`:
   ```js
   window.electronAPI.profiles.query({"search":"engineer"})
   ```
4. Electron's preload bridge forwards to `ipcRenderer.invoke('profiles:query', opts)`
5. Main process handler validates with Zod, calls service function, returns result
6. Result bubbles back: main → preload → CDP → MCP server → Claude

## Config File Schema

```typescript
// electron-mcp.config.ts
import { defineConfig } from 'electron-mcp-sdk'
import { profileQuerySchema, tagAddSchema } from './src/main/ipc-schemas'

export default defineConfig({
  // Connection
  app: {
    name: 'linkedin-recruiter',
    path: '.',
    debugPort: 9229,
    electronBin: './node_modules/.bin/electron',
  },

  // IPC Tools
  tools: {
    'profiles:query': {
      description: 'Search and filter LinkedIn profiles',
      schema: profileQuerySchema,
      // Auto-derived preloadPath: window.electronAPI.profiles.query
    },
    'crawl:start': {
      description: 'Start a new crawl job',
      schema: crawlJobSchema,
      preloadPath: 'window.electronAPI.crawl.startJob',
    },
    'profiles:stats': {
      description: 'Get profile database statistics',
    },
    'tags:getAll': {
      description: 'List all tags with usage counts',
      returns: 'Array of { name, count, type }',
    },
  },

  // Events as MCP Resources
  resources: {
    'crawl:progress': {
      description: 'Current crawl job progress',
      uri: 'electron://crawl/progress',
      pollExpression: 'window.electronAPI.crawl.getJobs()',
    },
    'session:status': {
      description: 'Current session/auth status',
      uri: 'electron://session/status',
      pollExpression: 'window.electronAPI.session.getStatus()',
    },
  },

  // CDP Tools (from electron-dev-bridge)
  cdpTools: true,

  // Screenshot config
  screenshots: {
    dir: '.screenshots',
    format: 'png',
  },
})
```

### Config Conventions

- **Auto-derived preload paths:** `profiles:query` → `window.electronAPI.profiles.query()`. Convention: `domain:action` → `electronAPI.{domain}.{action}()`. Override with `preloadPath`.
- **Zod schema → JSON Schema:** Provided Zod schemas are converted at startup for MCP `inputSchema`. Gives Claude full parameter knowledge.
- **`returns` hint:** Optional string describing return shape, included in tool description.
- **Resources as poll expressions:** Events implemented as pollable resources via CDP `Runtime.evaluate`.

## CLI Commands

### `npx electron-mcp init`

Scaffolds config by scanning source code:
1. Finds `ipcMain.handle()` calls via regex
2. Cross-references exported Zod schemas
3. Auto-derives descriptions from channel names
4. Generates `electron-mcp.config.ts`

### `npx electron-mcp serve`

Starts the MCP server (what Claude Code runs):
- Reads config, starts stdio MCP server
- Connects to Electron app on configured debugPort

### `npx electron-mcp register`

Registers with Claude Code:
- Runs `claude mcp add --scope user {name} -- npx electron-mcp serve`

### `npx electron-mcp validate`

Validates config and reports readiness:
- Checks tool definitions, schema linkage, preload path overrides
- Reports total tool count (IPC + CDP)

## Package Structure

```
electron-mcp-sdk/
├── package.json
├── src/
│   ├── index.ts              # Public API: defineConfig, types
│   ├── cli/
│   │   ├── index.ts          # CLI entry (init, serve, register, validate)
│   │   ├── init.ts           # Source scanner + config generator
│   │   ├── serve.ts          # MCP server startup
│   │   ├── register.ts       # Claude Code registration
│   │   └── validate.ts       # Config validation
│   ├── server/
│   │   ├── mcp-server.ts     # Core MCP server
│   │   ├── cdp-bridge.ts     # CDP connection management
│   │   ├── tool-builder.ts   # Config → MCP tool definitions
│   │   ├── resource-builder.ts
│   │   └── zod-to-jsonschema.ts
│   ├── cdp-tools/
│   │   └── index.ts          # 22 CDP tools from electron-dev-bridge
│   └── scanner/
│       ├── ipc-scanner.ts    # Scans for ipcMain.handle()
│       └── schema-scanner.ts # Finds and links Zod schemas
├── templates/
│   └── config.template.ts
└── dist/
```

### Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "chrome-remote-interface": "^0.33.2",
    "zod-to-json-schema": "^3.x"
  },
  "peerDependencies": {
    "zod": "^3.0.0 || ^4.0.0"
  }
}
```

Zod is a peer dependency — the host app already has it.

## Error Handling

- **CDP connection failure:** Retries with backoff. Message: "Cannot connect on port 9229. Is the app running with --remote-debugging-port=9229?"
- **Preload path not found:** Returns: "window.electronAPI.profiles.query is not a function. Check preloadPath in config."
- **Zod validation failure:** Passes Zod error details back to Claude for self-correction.
- **App crash:** MCP server stays alive, reconnects when app restarts.

## Relationship to electron-dev-bridge

- electron-dev-bridge continues as the standalone CDP-only MCP server
- electron-mcp-sdk incorporates its 22 CDP tools as the `cdp-tools/` module
- electron-dev-bridge = quick start for any Electron app (generic)
- electron-mcp-sdk = full-featured for apps that want IPC tools (app-specific)
