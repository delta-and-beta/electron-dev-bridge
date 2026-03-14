<div align="center">

<br>

# electron-dev-bridge

<br>

**Turn your Electron app's IPC handlers into MCP tools for Claude Code**

<br>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![CDP Tools](https://img.shields.io/badge/CDP_Tools-22-00D9C0?style=flat-square)](./src/cdp-tools)
[![License](https://img.shields.io/badge/License-MIT-FF6B5B?style=flat-square)](./LICENSE)

<br>

*Built for [Claude Code](https://claude.ai/code) — Connects Electron apps via [CDP](https://chromedevtools.github.io/devtools-protocol/) and [MCP](https://modelcontextprotocol.io)*

<br>

---

<br>

</div>

## Overview

electron-dev-bridge maps your Electron app's `ipcMain.handle()` channels to MCP tools that Claude Code can call directly. It also includes 22 built-in CDP tools for DOM automation, screenshots, and interaction — no IPC handlers required.

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

### CDP Tools (22)

**DOM Queries** — Selectors, text search, a11y tree<br>
**Interaction** — Click, type, key press, select<br>
**Visual** — Screenshots, diff, highlight

<br>
</td>
</tr>
<tr>
<td width="50%" valign="top">

### CLI

**`init`** — Scaffold config from source code<br>
**`register`** — One-command Claude Code setup<br>
**`validate`** — Check config without starting server

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

# Plus 22 built-in CDP tools
electron_screenshot
electron_click  selector="[data-testid='submit']"
electron_get_accessibility_tree
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

Your Electron app needs `--remote-debugging-port=9229` enabled. The bridge connects via Chrome DevTools Protocol to evaluate preload functions in the renderer process.

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

22 built-in tools for DOM automation. These work on any Electron app — no IPC configuration required.

<details>
<summary><b>Connection (2 tools)</b></summary>
<br>

| Tool | Description |
|:-----|:------------|
| `electron_launch` | Launch Electron app with remote debugging and connect via CDP |
| `electron_connect` | Connect to an already-running Electron app |

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
<summary><b>Interaction (4 tools)</b></summary>
<br>

| Tool | Description |
|:-----|:------------|
| `electron_click` | Click element by selector or x/y coordinates |
| `electron_type_text` | Type text into focused or targeted element |
| `electron_press_key` | Press special key (Enter, Tab, Escape, arrows, etc.) |
| `electron_select_option` | Select option in `<select>` by value or visible text |

</details>

<details>
<summary><b>State Reading (5 tools)</b></summary>
<br>

| Tool | Description |
|:-----|:------------|
| `electron_get_text` | Get innerText of an element |
| `electron_get_value` | Get value of input/textarea/select |
| `electron_get_attribute` | Get a specific attribute from an element |
| `electron_get_bounding_box` | Get position and dimensions (x, y, width, height) |
| `electron_get_url` | Get the current page URL |

</details>

<details>
<summary><b>Navigation & Viewport (3 tools)</b></summary>
<br>

| Tool | Description |
|:-----|:------------|
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
| `true` | Enable all 22 CDP tools |
| `false` / omitted | CDP tools disabled |
| `string[]` | Enable only the listed tool names |

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

Zod schemas are converted to JSON Schema via `zod-to-json-schema`. Zod is an optional peer dependency.

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
| Element not found | Use `electron_get_accessibility_tree` to inspect. Check for iframes or shadow DOM. |
| Blank screenshot | Add `electron_wait_for_selector` before capturing. |
| Stale connection | App reloaded or crashed. Use `electron_connect` to reconnect. |
| Config not found | Run `npx electron-mcp init` or create `electron-mcp.config.ts` manually. |
| Tool returns undefined | Check preload path matches `contextBridge` exposure. Run `npx electron-mcp validate`. |

<br>

## Architecture

```
src/
├── cdp-tools/                # 22 CDP tool implementations
│   ├── lifecycle.ts           # electron_launch, electron_connect
│   ├── dom-query.ts           # query_selector, find_by_text, a11y_tree
│   ├── interaction.ts         # click, type_text, press_key, select_option
│   ├── state.ts               # get_text, get_value, get_attribute, get_url
│   ├── navigation.ts          # wait_for_selector, set_viewport, scroll
│   └── visual.ts              # screenshot, compare_screenshots, highlight
├── server/                    # MCP server runtime
│   ├── mcp-server.ts          # Server setup, tool/resource dispatch
│   ├── cdp-bridge.ts          # CDP connection management
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
└── index.ts                   # Public API: defineConfig, types
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
