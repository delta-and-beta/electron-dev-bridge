# electron-mcp-sdk

Expose your Electron app's IPC handlers as [MCP](https://modelcontextprotocol.io/) tools for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Optionally includes 22 built-in CDP tools for DOM inspection, interaction, and screenshots.

```
Claude Code (terminal)
  |  MCP protocol (stdio)
  v
electron-mcp-sdk (MCP server)
  |  Chrome DevTools Protocol
  v
Electron app (--remote-debugging-port=9229)
```

## Quick Start

```bash
# In your Electron project directory:
npm install electron-mcp-sdk

# Scaffold a config from your source code
npx electron-mcp init

# Review the generated config
cat electron-mcp.config.ts

# Register with Claude Code
npx electron-mcp register
```

That's it. Claude Code can now call your app's IPC handlers as tools.

## How It Works

1. **You define a config** mapping `ipcMain.handle()` channels to MCP tools
2. **The SDK starts an MCP server** that Claude Code connects to via stdio
3. **When Claude calls a tool**, the SDK evaluates the corresponding preload function via CDP
4. **Results flow back** through MCP to Claude

Your Electron app needs to be running with `--remote-debugging-port` enabled. The SDK connects via Chrome DevTools Protocol to evaluate JavaScript in the renderer process.

## Config File

The `init` command generates `electron-mcp.config.ts` by scanning your source for `ipcMain.handle()` calls and Zod schema exports. Edit it to refine descriptions, add schemas, or configure CDP tools.

```ts
import { defineConfig } from 'electron-mcp-sdk'
import { profileQuerySchema } from './src/main/ipc-schemas'

export default defineConfig({
  app: {
    name: 'my-app',           // MCP server name
    path: '/path/to/app',     // Electron app directory (optional)
    debugPort: 9229,           // CDP port (default: 9229)
    electronBin: '/path/to/electron', // Custom Electron binary (optional)
  },

  tools: {
    'profiles:query': {
      description: 'Search and filter profiles with pagination',
      schema: profileQuerySchema,           // Zod schema for input validation
      returns: 'Array of profile objects',  // Appended to description
    },
    'crawl:start': {
      description: 'Start a new crawl job',
      preloadPath: 'window.electronAPI.crawl.startJob', // Override auto-derived path
    },
  },

  resources: {
    'crawl:progress': {
      description: 'Live crawl progress',
      uri: 'electron://my-app/crawl/progress',
      pollExpression: 'window.__crawlProgress || { crawled: 0, total: 0 }',
    },
  },

  cdpTools: true,              // Enable all 22 built-in CDP tools
  // cdpTools: ['electron_screenshot', 'electron_click'], // Or pick specific ones

  screenshots: {
    dir: './screenshots',      // Screenshot output directory
    format: 'png',             // 'png' or 'jpeg'
  },
})
```

## Config Reference

### `app`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | *required* | MCP server name, shown in Claude Code |
| `path` | `string` | — | Electron app directory (for `electron_launch`) |
| `debugPort` | `number` | `9229` | CDP remote debugging port |
| `electronBin` | `string` | `{path}/node_modules/.bin/electron` | Path to Electron binary |

### `tools`

Each key is an IPC channel name in `domain:action` format. The SDK auto-derives:

- **MCP tool name**: `profiles:query` → `profiles_query`
- **Preload path**: `profiles:query` → `window.electronAPI.profiles.query`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | `string` | *required* | Tool description shown to Claude |
| `schema` | `ZodType` | — | Zod schema; converted to JSON Schema for input validation |
| `preloadPath` | `string` | auto-derived | Override the renderer-side function path |
| `returns` | `string` | — | Appended to description as `Returns: {value}` |

### `resources`

Expose live app state that Claude can read on demand.

| Field | Type | Description |
|-------|------|-------------|
| `description` | `string` | Resource description |
| `uri` | `string` | Unique resource URI (e.g. `electron://app/domain/resource`) |
| `pollExpression` | `string` | JavaScript evaluated in the renderer to fetch current data |

### `cdpTools`

| Value | Behavior |
|-------|----------|
| `true` | Enable all 22 CDP tools |
| `false` / omitted | CDP tools disabled |
| `string[]` | Enable only the listed tool names |

### `screenshots`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dir` | `string` | `.screenshots` | Output directory |
| `format` | `'png' \| 'jpeg'` | `'png'` | Image format |

## CLI Commands

| Command | Description |
|---------|-------------|
| `npx electron-mcp serve [config]` | Start the MCP server (default command) |
| `npx electron-mcp init` | Scan source for IPC handlers and Zod schemas, generate config |
| `npx electron-mcp register` | Register with Claude Code via `claude mcp add` |
| `npx electron-mcp validate` | Validate config and report readiness |

### `init`

Scans your project for:
- `ipcMain.handle('channel', ...)` calls → generates tool entries
- `export const fooSchema = z.{...}` exports → links schemas to matching channels

Outputs `electron-mcp.config.ts` with all discovered handlers pre-configured.

### `validate`

Checks your config without starting the server:
- Config file loads correctly
- `app.name` is set
- Reports tool count, schema count, resource count, and CDP status

### `register`

Runs `claude mcp add --scope user {name} -- npx electron-mcp serve` to register the server with Claude Code. Equivalent to manually adding to `~/.claude.json`.

## CDP Tools

When `cdpTools` is enabled, 22 built-in tools are available for DOM automation, interaction, and visual testing. These work on any Electron app — no IPC handlers required.

### Connection

| Tool | Description |
|------|-------------|
| `electron_launch` | Launch Electron app with remote debugging and connect via CDP |
| `electron_connect` | Connect to an already-running Electron app |

### DOM Queries

| Tool | Description |
|------|-------------|
| `electron_query_selector` | Find one element by CSS selector |
| `electron_query_selector_all` | Find all matching elements (up to 50) |
| `electron_find_by_text` | Find elements containing text via XPath |
| `electron_find_by_role` | Find elements by ARIA role (explicit or implicit) |
| `electron_get_accessibility_tree` | Structured accessibility tree with roles, names, and states |

### Interaction

| Tool | Description |
|------|-------------|
| `electron_click` | Click element by selector or x/y coordinates |
| `electron_type_text` | Type text into focused or targeted element |
| `electron_press_key` | Press special key (Enter, Tab, Escape, arrows, etc.) |
| `electron_select_option` | Select option in `<select>` by value or visible text |

### State Reading

| Tool | Description |
|------|-------------|
| `electron_get_text` | Get innerText of an element |
| `electron_get_value` | Get value of input/textarea/select |
| `electron_get_attribute` | Get a specific attribute from an element |
| `electron_get_bounding_box` | Get position and dimensions (x, y, width, height) |
| `electron_get_url` | Get the current page URL |

### Navigation & Viewport

| Tool | Description |
|------|-------------|
| `electron_wait_for_selector` | Poll for element to appear (default timeout: 5s) |
| `electron_set_viewport` | Set viewport dimensions for responsive testing |
| `electron_scroll` | Scroll page or element in a direction |

### Screenshots & Visual

| Tool | Description |
|------|-------------|
| `electron_screenshot` | Capture full page or element screenshot |
| `electron_compare_screenshots` | Byte-level diff of two screenshots (returns diff %) |
| `electron_highlight_element` | Outline element in red for 3 seconds |

## Preload Path Convention

The SDK assumes your Electron app exposes IPC handlers via a preload script using the `contextBridge` pattern:

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

The channel `profiles:query` maps to `window.electronAPI.profiles.query`. If your preload uses a different naming scheme, override with `preloadPath`:

```ts
tools: {
  'crawl:start': {
    description: 'Start a crawl job',
    preloadPath: 'window.electronAPI.crawl.startJob',
  },
}
```

## Zod Schema Integration

If your app defines Zod schemas for IPC input validation, import them in your config to get typed tool inputs:

```ts
import { defineConfig } from 'electron-mcp-sdk'
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

The SDK converts Zod schemas to JSON Schema using `zod-to-json-schema`, which MCP clients use for input validation and documentation. Zod is an optional peer dependency — the SDK works without it.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Cannot connect to app | Ensure app runs with `--remote-debugging-port=9229`. Check `lsof -i :9229` for port conflicts. |
| Element not found | Use `electron_get_accessibility_tree` to inspect what's rendered. Check for iframes or shadow DOM. |
| Blank screenshot | Add `electron_wait_for_selector` before capturing to ensure content is loaded. |
| Stale connection | App reloaded or crashed. Use `electron_connect` to reconnect. |
| Config not found | Run `npx electron-mcp init` or create `electron-mcp.config.ts` manually. |
| Tool returns undefined | Check that your preload path matches the actual `contextBridge` exposure. Run `npx electron-mcp validate`. |

## Sample Skills for Claude Code

The `skills/` directory contains sample [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) that teach Claude how to use the SDK effectively. Copy the ones you need into your project's `.claude/skills/` directory:

```bash
# Copy all sample skills
cp -r node_modules/electron-mcp-sdk/skills/* .claude/skills/

# Or copy individual skills
cp -r node_modules/electron-mcp-sdk/skills/electron-app-dev .claude/skills/
cp -r node_modules/electron-mcp-sdk/skills/electron-e2e-testing .claude/skills/
cp -r node_modules/electron-mcp-sdk/skills/electron-debugging .claude/skills/
```

| Skill | Triggers on | What it covers |
|-------|-------------|----------------|
| `electron-app-dev` | Electron app, desktop app, UI automation, DOM inspection, IPC | Tool reference, selector strategy, IPC usage, build & verify playbooks |
| `electron-e2e-testing` | Test, e2e, regression, form testing, UI verification | Test patterns, form automation, visual regression, multi-page flows |
| `electron-debugging` | Debug, bug, broken, not working, element not found | Diagnostic flowcharts, connection troubleshooting, common error patterns |

After copying, Claude Code will automatically load the relevant skill when your prompts match its trigger keywords.

## Requirements

- Node.js >= 18
- Electron app with `--remote-debugging-port` enabled
- Claude Code CLI (for `register` command)

## License

MIT
