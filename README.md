<div align="center">

<br>

# electron-dev-bridge

<br>

**Turn your Electron app's IPC handlers into MCP tools for Claude Code**

<br>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![CDP Tools](https://img.shields.io/badge/CDP_Tools-31-00D9C0?style=flat-square)](./src/cdp-tools)
[![License](https://img.shields.io/badge/License-MIT-FF6B5B?style=flat-square)](./LICENSE)

<br>

*Built for [Claude Code](https://claude.ai/code) — Connects Electron apps via [CDP](https://chromedevtools.github.io/devtools-protocol/) and [MCP](https://modelcontextprotocol.io)*

<br>

---

<br>

</div>

## Overview

electron-dev-bridge maps your Electron app's `ipcMain.handle()` channels to MCP tools that Claude Code can call directly. It includes 31 built-in CDP tools for DOM automation, screenshots, interaction, JS evaluation, console/network capture, and multi-window support — no IPC handlers required.

```
Your Electron App                   Claude Code
     ↓                                  ↓
ipcMain.handle('profiles:query')    profiles_query  ← MCP tool
ipcMain.handle('tags:add')          tags_add        ← MCP tool
ipcMain.handle('crawl:start')       crawl_start     ← MCP tool
     ↓                                  ↓
contextBridge / preload.js    ←→    electron-dev-bridge (MCP server)
                                         ↓
                              Chrome DevTools Protocol (port 9229)
```

<br>

## When to Use

electron-dev-bridge is ideal when you need:

- **Your app's IPC handlers as Claude Code tools** with Zod schema validation
- **DOM automation** for testing, debugging, or building Electron apps
- **Screenshot-based QA** with visual comparison
- **Console and network observability** without custom IPC hooks
- **Multi-window support** for apps with multiple BrowserWindows
- **Custom tools** alongside built-in CDP and IPC tools
- **Live app state** exposed as MCP resources Claude can read on demand

For generic browser automation without Electron-specific features, a standard Chrome DevTools MCP server works fine.

<br>

## Capabilities

<table>
<tr>
<td width="50%" valign="top">

### IPC Bridge

**Auto-Discovery** — Scans `ipcMain.handle()` calls<br>
**Zod Schemas** — Typed tool inputs from existing schemas<br>
**Preload Mapping** — `domain:action` → `window.electronAPI.domain.action`

<br>
</td>
<td width="50%" valign="top">

### CDP Tools (31)

**DOM Queries** — Selectors, text search, a11y tree<br>
**Interaction** — Click, type, fill, key press, select<br>
**Visual** — Screenshots, diff, highlight<br>
**DevTools** — Console logs, network requests<br>
**Multi-Window** — List targets, switch windows

<br>
</td>
</tr>
<tr>
<td width="50%" valign="top">

### CLI + Library API

**`init`** — Scaffold config from source code<br>
**`register`** — One-command Claude Code setup<br>
**`startServer`** — Programmatic embedding<br>
**Custom Tools** — Plugin API for arbitrary handlers

<br>
</td>
<td width="50%" valign="top">

### Skills

**3 Sample Skills** — Drop into `.claude/skills/`<br>
**App Dev** — Tool reference and playbooks<br>
**E2E Testing** — Test patterns and visual regression<br>
**Debugging** — Diagnostic flowcharts

<br>
</td>
</tr>
</table>

<br>

## Quick Start

```bash
# Install in your Electron project
npm install electron-dev-bridge

# Scaffold a config from your source code
npx electron-mcp init

# Review the generated config
cat electron-mcp.config.ts

# Register with Claude Code
npx electron-mcp register
```

Then in Claude Code:

```
# Your IPC handlers are now tools
profiles_query  query="test user"
tags_add  profileId="123"  tag="vip"

# 31 built-in CDP tools
electron_evaluate  expression="document.title"
electron_screenshot
electron_click  selector="[data-testid='submit']"
electron_fill  selector="#email"  text="new@example.com"
electron_get_console_logs  level="error"
electron_get_network_requests  errorsOnly=true
```

<br>

## How It Works

```
┌──────────────────────────────────────────────────────────────────┐
│                      electron-dev-bridge                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. CONFIG         Define IPC channels as MCP tools             │
│        ↓            (electron-mcp.config.ts)                     │
│                                                                  │
│   2. SCAN           Auto-detect ipcMain.handle() + Zod schemas   │
│        ↓            (npx electron-mcp init)                      │
│                                                                  │
│   3. REGISTER       Add MCP server to Claude Code                │
│        ↓            (npx electron-mcp register)                  │
│                                                                  │
│   4. SERVE          Start MCP server, connect via CDP            │
│        ↓            (npx electron-mcp serve)                     │
│                                                                  │
│   5. BRIDGE         Claude calls tool → preload function → IPC   │
│                     Results flow back through MCP                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Your Electron app needs `--remote-debugging-port=9229` enabled. The bridge connects via Chrome DevTools Protocol to evaluate preload functions in the renderer process. Auto-reconnects on HMR/page reload.

<br>

## Config File

The `init` command generates `electron-mcp.config.ts` by scanning your source for `ipcMain.handle()` calls and Zod schema exports.

```ts
import { defineConfig } from 'electron-dev-bridge'
import { profileQuerySchema } from './src/main/ipc-schemas'

export default defineConfig({
  app: {
    name: 'my-app',
    path: '/path/to/app',
    debugPort: 9229,
  },

  tools: {
    'profiles:query': {
      description: 'Search and filter profiles with pagination',
      schema: profileQuerySchema,
      returns: 'Array of profile objects',
    },
    'crawl:start': {
      description: 'Start a new crawl job',
      preloadPath: 'window.electronAPI.crawl.startJob',
    },
  },

  resources: {
    'crawl:progress': {
      description: 'Live crawl progress',
      uri: 'electron://my-app/crawl/progress',
      pollExpression: 'window.__crawlProgress || { crawled: 0, total: 0 }',
    },
  },

  cdpTools: true,
  screenshots: { dir: './screenshots', format: 'png' },

  customTools: [
    {
      name: 'list_schemas',
      description: 'List XDM schemas from API',
      inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
      handler: async (args) => ({
        content: [{ type: 'text', text: JSON.stringify(await myApi.listSchemas(args.limit)) }],
      }),
    },
  ],
})
```

<br>

## IPC Tool Naming

IPC channel names use colon-separated `domain:action` format. The bridge auto-derives tool names and preload paths:

| IPC Channel | MCP Tool Name | Preload Path |
|:------------|:--------------|:-------------|
| `profiles:query` | `profiles_query` | `window.electronAPI.profiles.query` |
| `tags:add` | `tags_add` | `window.electronAPI.tags.add` |
| `crawl:start` | `crawl_start` | `window.electronAPI.crawl.start` |

Override the preload path when the actual method name differs:

```ts
'crawl:start': {
  description: 'Start a crawl job',
  preloadPath: 'window.electronAPI.crawl.startJob',
}
```

<br>

## CLI Commands

| Command | Description |
|:--------|:------------|
| `npx electron-mcp serve [config]` | Start the MCP server (default) |
| `npx electron-mcp init` | Scan source for IPC handlers and Zod schemas, generate config |
| `npx electron-mcp register` | Register with Claude Code via `claude mcp add` |
| `npx electron-mcp validate` | Validate config and report readiness |
| `npx electron-mcp --version` | Show version |

<br>

## CDP Tools

31 built-in tools for DOM automation, interaction, observability, and multi-window support. These work on any Electron app — no IPC configuration required.

<details>
<summary><b>Connection & Targets (4 tools)</b></summary>
<br>

| Tool | Description |
|:-----|:------------|
| `electron_launch` | Launch Electron app with remote debugging and connect via CDP |
| `electron_connect` | Connect to an already-running Electron app |
| `electron_list_targets` | List all page targets (BrowserWindows) with IDs, titles, and URLs |
| `electron_switch_target` | Switch CDP connection to a different window by target ID or URL pattern |

</details>

<details>
<summary><b>DOM Queries (5 tools)</b></summary>
<br>

| Tool | Description |
|:-----|:------------|
| `electron_query_selector` | Find one element by CSS selector |
| `electron_query_selector_all` | Find all matching elements (up to 50) |
| `electron_find_by_text` | Find elements containing text via XPath |
| `electron_find_by_role` | Find elements by ARIA role (explicit or implicit) |
| `electron_get_accessibility_tree` | Structured a11y tree with roles, names, and states |

</details>

<details>
<summary><b>Interaction (5 tools)</b></summary>
<br>

| Tool | Description |
|:-----|:------------|
| `electron_click` | Click element by selector or x/y coordinates |
| `electron_type_text` | Type text into focused or targeted element (appends) |
| `electron_fill` | Clear field contents and type new text (replaces) |
| `electron_press_key` | Press special key (Enter, Tab, Escape, arrows, etc.) |
| `electron_select_option` | Select option in `<select>` by value or visible text |

</details>

<details>
<summary><b>State Reading (6 tools)</b></summary>
<br>

| Tool | Description |
|:-----|:------------|
| `electron_get_text` | Get innerText of an element |
| `electron_get_value` | Get value of input/textarea/select |
| `electron_get_attribute` | Get a specific attribute from an element |
| `electron_get_bounding_box` | Get position and dimensions (x, y, width, height) |
| `electron_get_url` | Get the current page URL |
| `electron_evaluate` | Execute arbitrary JavaScript in the renderer and return result |

</details>

<details>
<summary><b>Navigation & Viewport (4 tools)</b></summary>
<br>

| Tool | Description |
|:-----|:------------|
| `electron_navigate` | Navigate to a URL and wait for page load |
| `electron_wait_for_selector` | Poll for element to appear (default timeout: 5s) |
| `electron_set_viewport` | Override viewport metrics for responsive testing |
| `electron_scroll` | Scroll page or element in a direction |

</details>

<details>
<summary><b>Screenshots & Visual (3 tools)</b></summary>
<br>

| Tool | Description |
|:-----|:------------|
| `electron_screenshot` | Capture full page or element screenshot |
| `electron_compare_screenshots` | Byte-level diff of two screenshots (returns diff %) |
| `electron_highlight_element` | Outline element in red for 3 seconds |

</details>

<details>
<summary><b>DevTools Capture (4 tools)</b></summary>
<br>

Console and network observability using CDP events — no app changes needed.

| Tool | Description |
|:-----|:------------|
| `electron_get_console_logs` | Read captured console messages (filter by level, search, since) |
| `electron_get_network_requests` | Read captured HTTP requests (filter by URL, method, errors) |
| `electron_clear_devtools_data` | Clear console and/or network capture buffers |
| `electron_get_devtools_stats` | Get counts of captured console logs and network requests |

Buffers: 1000 console entries, 500 network entries max. Capture starts automatically on connect.

</details>

<br>

## Config Reference

<details>
<summary><b>app</b></summary>
<br>

| Field | Type | Default | Description |
|:------|:-----|:--------|:------------|
| `name` | `string` | *required* | MCP server name, shown in Claude Code |
| `path` | `string` | — | Electron app directory (for `electron_launch`) |
| `debugPort` | `number` | `9229` | CDP remote debugging port |
| `electronBin` | `string` | `{path}/node_modules/.bin/electron` | Path to Electron binary |

</details>

<details>
<summary><b>tools</b></summary>
<br>

Each key is an IPC channel name in `domain:action` format.

| Field | Type | Default | Description |
|:------|:-----|:--------|:------------|
| `description` | `string` | *required* | Tool description shown to Claude |
| `schema` | `ZodType` | — | Zod schema; converted to JSON Schema for input validation |
| `preloadPath` | `string` | auto-derived | Override the renderer-side function path |
| `returns` | `string` | — | Appended to description as `Returns: {value}` |

</details>

<details>
<summary><b>resources</b></summary>
<br>

Expose live app state that Claude can read on demand.

| Field | Type | Description |
|:------|:-----|:------------|
| `description` | `string` | Resource description |
| `uri` | `string` | Unique resource URI (e.g. `electron://app/domain/resource`) |
| `pollExpression` | `string` | JavaScript evaluated in the renderer to fetch current data |

</details>

<details>
<summary><b>cdpTools</b></summary>
<br>

| Value | Behavior |
|:------|:---------|
| `true` | Enable all 31 CDP tools |
| `false` / omitted | CDP tools disabled |
| `string[]` | Enable only the listed tool names |

</details>

<details>
<summary><b>customTools</b></summary>
<br>

Register arbitrary tool handlers alongside IPC and CDP tools.

```ts
customTools: [{
  name: 'my_tool',
  description: 'What it does',
  inputSchema: { type: 'object', properties: { ... } },
  handler: async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(result) }],
  }),
}]
```

Custom tools are dispatched after IPC and CDP tools — they can't shadow built-in tools.

</details>

<details>
<summary><b>screenshots</b></summary>
<br>

| Field | Type | Default | Description |
|:------|:-----|:--------|:------------|
| `dir` | `string` | `.screenshots` | Output directory |
| `format` | `'png' \| 'jpeg'` | `'png'` | Image format |

</details>

<br>

## Library API

Import and use programmatically — no CLI required:

```ts
import { startServer, CdpBridge, getCdpTools, defineConfig } from 'electron-dev-bridge'

// Start the full MCP server programmatically
await startServer(config)

// Or use components individually
const bridge = new CdpBridge(9229)
await bridge.connect()
const tools = getCdpTools(bridge, config.app, config.screenshots)
```

<br>

## Preload Convention

The bridge assumes your app uses the `contextBridge` pattern:

```js
// preload.js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  profiles: {
    query: (args) => ipcRenderer.invoke('profiles:query', args),
    get: (id) => ipcRenderer.invoke('profiles:get', id),
  },
  tags: {
    add: (args) => ipcRenderer.invoke('tags:add', args),
  },
})
```

The channel `profiles:query` maps to `window.electronAPI.profiles.query`. Override with `preloadPath` when the naming differs.

<br>

## Zod Schema Integration

Import your existing Zod schemas for typed tool inputs:

```ts
import { defineConfig } from 'electron-dev-bridge'
import { profileQuerySchema, crawlJobSchema } from './src/main/ipc-schemas'

export default defineConfig({
  app: { name: 'my-app' },
  tools: {
    'profiles:query': {
      description: 'Search profiles',
      schema: profileQuerySchema,
    },
    'crawl:start': {
      description: 'Start a crawl',
      schema: crawlJobSchema,
      preloadPath: 'window.electronAPI.crawl.startJob',
    },
  },
})
```

Zod schemas are converted to JSON Schema via `zod-to-json-schema`. Supports Zod v3 and v4.

<br>

## Sample Skills

Three [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) that teach Claude how to use the bridge effectively.

```bash
# Copy all sample skills
cp -r node_modules/electron-dev-bridge/skills/* .claude/skills/

# Or copy individual skills
cp -r node_modules/electron-dev-bridge/skills/electron-app-dev .claude/skills/
```

| Skill | Triggers On | Covers |
|:------|:------------|:-------|
| `electron-app-dev` | Electron app, desktop app, UI automation, DOM, IPC | Tool reference, selector strategy, build & verify playbooks |
| `electron-e2e-testing` | Test, e2e, regression, form testing | Test patterns, form automation, visual regression, multi-page flows |
| `electron-debugging` | Debug, bug, broken, not working, element not found | Diagnostic flowcharts, connection troubleshooting, error patterns |

Claude Code automatically loads the relevant skill when prompts match trigger keywords.

<br>

## Troubleshooting

| Problem | Fix |
|:--------|:----|
| Cannot connect to app | Ensure app runs with `--remote-debugging-port=9229`. Check `lsof -i :9229`. |
| Connects to DevTools instead of app | Bridge auto-skips `devtools://` targets. If issue persists, use `electron_list_targets` to find the right window. |
| Element not found | Use `electron_get_accessibility_tree` to inspect. Check for iframes or shadow DOM. |
| Blank screenshot | Add `electron_wait_for_selector` before capturing. |
| Stale connection | Bridge auto-reconnects on disconnect. If still stale, call `electron_connect`. |
| Config not found | Run `npx electron-mcp init` or create `electron-mcp.config.ts` manually. |
| Tool returns undefined | Check preload path matches `contextBridge` exposure. Run `npx electron-mcp validate`. |
| Wrong window targeted | Use `electron_list_targets` then `electron_switch_target` to select the right BrowserWindow. |

<br>

## Architecture

```
src/
├── cdp-tools/                # 31 CDP tool implementations
│   ├── lifecycle.ts           # launch, connect, list_targets, switch_target
│   ├── dom-query.ts           # query_selector, find_by_text, a11y_tree
│   ├── interaction.ts         # click, type_text, fill, press_key, select_option
│   ├── state.ts               # get_text, get_value, get_attribute, get_url, evaluate
│   ├── navigation.ts          # navigate, wait_for_selector, set_viewport, scroll
│   ├── visual.ts              # screenshot, compare_screenshots, highlight
│   └── devtools.ts            # get_console_logs, get_network_requests, clear, stats
├── server/                    # MCP server runtime
│   ├── mcp-server.ts          # Server setup, IPC/CDP/custom tool dispatch
│   ├── cdp-bridge.ts          # CDP connection, auto-reconnect, multi-target
│   ├── tool-builder.ts        # IPC channel → MCP tool conversion
│   └── resource-builder.ts    # Config resources → MCP resources
├── cli/                       # CLI commands
│   ├── index.ts               # Entry point (serve, init, register, validate)
│   ├── serve.ts               # Load config, start server
│   ├── init.ts                # Scan source, generate config
│   ├── register.ts            # claude mcp add
│   └── validate.ts            # Config validation
├── scanner/                   # Source code scanners
│   ├── ipc-scanner.ts         # Find ipcMain.handle() calls
│   └── schema-scanner.ts      # Find Zod schema exports
└── index.ts                   # Public API: defineConfig, CdpBridge, getCdpTools, startServer
```

<br>

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npm run lint
```

<br>

## References

| | |
|:--|:--|
| Claude Code | [claude.ai/code](https://claude.ai/code) |
| MCP Specification | [modelcontextprotocol.io](https://modelcontextprotocol.io) |
| MCP SDK | [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) |
| Chrome DevTools Protocol | [chromedevtools.github.io/devtools-protocol](https://chromedevtools.github.io/devtools-protocol/) |
| Electron | [electronjs.org](https://www.electronjs.org/) |

<br>

---

<div align="center">

<br>

MIT License

<br>

</div>
