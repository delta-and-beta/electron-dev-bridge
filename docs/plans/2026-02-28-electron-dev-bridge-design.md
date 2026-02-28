# Electron Dev Bridge — Design Document

**Date:** 2026-02-28
**Status:** Approved

## Overview

A portable MCP server toolkit that lets Claude Code drive any Electron app via Chrome DevTools Protocol. Zero coupling — connects via `--remote-debugging-port`, no changes to the target app required.

## Deliverables

1. **MCP Server** (`scripts/mcp-server.js`) — 25 tools wrapping CDP for DOM inspection, interaction, screenshots
2. **Preload Script** (`scripts/preload.js`) — optional enhanced DOM access via contextBridge
3. **Screenshot Diff CLI** (`scripts/screenshot-diff.js`) — standalone visual comparison tool
4. **SKILL.md** — operational playbooks teaching Claude when/how to chain tools
5. **Reference docs** — full API reference, expanded playbooks, CDP cheat sheet
6. **Examples** — 3 worked examples with tool call sequences

## Architecture

```
Claude Code (terminal)
  ↕ MCP protocol (stdio)
electron-dev-bridge/scripts/mcp-server.js
  ↕ Chrome DevTools Protocol (CDP) over WebSocket
Electron App (launched with --remote-debugging-port=9229)
  ├── Main Process
  └── Renderer Process
       └── preload.js (optional)
```

**Dependencies:** `@modelcontextprotocol/sdk`, `chrome-remote-interface`
**Runtime:** Node.js, ES modules (except preload which is CommonJS)
**Transport:** stdio (standard MCP pattern)

## Directory Structure

```
electron-dev-bridge/
├── SKILL.md
├── scripts/
│   ├── package.json
│   ├── mcp-server.js        # Single file, ~800-1000 lines, clear sections
│   ├── preload.js            # CommonJS, ~150 lines
│   └── screenshot-diff.js    # ES module CLI, ~100 lines
├── references/
│   ├── tools-api.md
│   ├── playbooks.md
│   └── cdp-reference.md
└── examples/
    ├── basic-test.md
    ├── form-automation.md
    └── visual-regression.md
```

## MCP Server Design

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ELECTRON_APP_PATH` | `""` | Default app path for `electron_launch` |
| `ELECTRON_DEBUG_PORT` | `9229` | CDP port |
| `ELECTRON_BIN` | `<appPath>/node_modules/.bin/electron` | Electron binary path |
| `SCREENSHOT_DIR` | `.screenshots/` in cwd | Screenshot output directory |

### Internal Structure

1. **Imports & Config** (~20 lines) — SDK, CDP, Node builtins, env vars
2. **State & Helpers** (~80 lines) — connection state, `connectToCDP()`, `ensureConnected()`, `getBoundingBox()`, `evaluateJS()`
3. **Tool Definitions** (~700-800 lines) — 25 tools in 6 groups
4. **Server Startup** (~15 lines) — create server, stdio transport, signal handlers

### Tools (25 total)

**Connection & Lifecycle (2)**
- `electron_launch` — spawn electron with debug port, connect CDP
- `electron_connect` — connect to already-running app

**DOM Queries (5)**
- `electron_query_selector` — single element by CSS selector
- `electron_query_selector_all` — multiple elements (first 50)
- `electron_find_by_text` — XPath text search
- `electron_find_by_role` — ARIA role + implicit role mapping
- `electron_get_accessibility_tree` — recursive a11y tree with visibility filtering

**Interactions (4)**
- `electron_click` — click by selector or coordinates
- `electron_type_text` — type text, optionally into selector
- `electron_press_key` — dispatch keyboard events (Enter, Tab, Escape, etc.)
- `electron_select_option` — select dropdown option by value or text

**Reading State (5)**
- `electron_get_text` — element innerText
- `electron_get_value` — input element value
- `electron_get_attribute` — any element attribute
- `electron_get_bounding_box` — element dimensions and position
- `electron_get_url` — current page URL

**Navigation & Viewport (3)**
- `electron_wait_for_selector` — poll for element with timeout
- `electron_set_viewport` — change viewport dimensions
- `electron_scroll` — scroll window or element

**Screenshots & Visual (3)**
- `electron_screenshot` — capture full page or element
- `electron_compare_screenshots` — byte-level comparison
- `electron_highlight_element` — red outline debug aid

### Error Handling

All tool handlers wrapped in try/catch. Errors return `{ isError: true }` with actionable messages (e.g., "Not connected. Use electron_launch or electron_connect first.").

### Connection Logic

`connectToCDP(port, maxRetries=10)` — retry with 1s intervals. Uses `CDP.List()` to find page target, connects, enables `Runtime`, `DOM`, `Page`, `Network` domains.

## Preload Script

CommonJS. Uses `contextBridge.exposeInMainWorld('__electronDevBridge', {...})`:
- `getAccessibilityTree(maxDepth)` — enhanced a11y tree
- `findByText(text, options)` — XPath with bounding boxes
- `getComputedStyles(selector, properties)` — batch CSS reads
- `scrollIntoView(selector)` — smooth scroll to center
- `getFormSummary()` — enumerate forms and fields

MCP server tools try preload bridge first, fall back to inline `Runtime.evaluate`.

## Screenshot Diff CLI

`node screenshot-diff.js baseline.png current.png [--output diff.png] [--threshold 0.1]`
- Dynamic import of `pixelmatch` + `pngjs` (optional deps)
- Falls back to byte-level Buffer comparison
- JSON output to stdout
- Exit codes: 0=identical, 1=different, 2=error

## SKILL.md (<500 lines)

Sections:
- Quick Start (mcp.json config, 4 steps)
- Architecture diagram (ASCII)
- Tool reference table (grouped, links to tools-api.md)
- 5 Operational Playbooks:
  1. Build and Verify UI Feature
  2. End-to-End Interaction Test
  3. Visual Regression Test
  4. Debug a UI Bug
  5. Form Automation
- Screenshot Evaluation Guide (layout, text, colors, states, responsiveness)
- Selector Strategy (data-testid > ARIA > CSS classes > hierarchy)
- Waiting Strategy (wait_for_selector, not sleep)
- Troubleshooting (connection, element not found, blank screenshots)

## Design Decisions

1. **Single file MCP server** — coherent unit, no import graph, Claude reads it as one block
2. **Independent from chrome-devtools MCP** — parallel toolkits, no overlap concerns
3. **Standalone project** — manual mcp.json registration, no Nick plugin packaging
4. **All 25 tools** — complete self-contained toolkit per spec
5. **No TypeScript** — zero build step, plain ES modules
6. **Preload is optional** — tools work via Runtime.evaluate, preload enhances quality
7. **Screenshots to disk** — Claude reads image files directly, paths returned in tool results
