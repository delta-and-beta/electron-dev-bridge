---
name: electron-app-dev
description: >
  Develop and automate Electron apps using the electron-dev-bridge bridge.
  Trigger on: Electron app, desktop app, UI automation, DOM inspection,
  IPC handler, screenshot, BrowserWindow, webContents, CDP tools,
  electron-mcp, preload script, contextBridge.
---

# Electron App Development with electron-dev-bridge

Use the MCP bridge to connect, inspect, interact with, and screenshot your Electron app directly from Claude Code.

## Prerequisites

1. Install: `npm install electron-dev-bridge`
2. Generate config: `npx electron-mcp init`
3. Register: `npx electron-mcp register`
4. Start your app with `--remote-debugging-port=9229`

## Connecting

```
# Launch and connect in one step
electron_launch  appPath="/path/to/{YOUR_APP}"

# Or connect to an already-running app (uses the port from your config)
electron_connect
```

Always connect before using any other tools.

## Tool Reference

### Connection
| Tool | Use for |
|------|---------|
| `electron_launch` | Launch app with debug port and connect |
| `electron_connect` | Connect to running app |

### DOM Queries
| Tool | Use for |
|------|---------|
| `electron_query_selector` | Find one element by CSS selector |
| `electron_query_selector_all` | Find all matching elements (max 50) |
| `electron_find_by_text` | Find elements by visible text content |
| `electron_find_by_role` | Find elements by ARIA role |
| `electron_get_accessibility_tree` | Full a11y tree with roles and names |

### Interaction
| Tool | Use for |
|------|---------|
| `electron_click` | Click by selector or coordinates |
| `electron_type_text` | Type into input (provide `selector` to auto-focus) |
| `electron_press_key` | Press Enter, Tab, Escape, arrows, etc. |
| `electron_select_option` | Select dropdown option by value or text |

### State Reading
| Tool | Use for |
|------|---------|
| `electron_get_text` | Get innerText of element |
| `electron_get_value` | Get input/textarea/select value |
| `electron_get_attribute` | Get specific attribute |
| `electron_get_bounding_box` | Get element position and size |
| `electron_get_url` | Get current page URL |

### Navigation & Viewport
| Tool | Use for |
|------|---------|
| `electron_wait_for_selector` | Wait for element to appear (default 5s) |
| `electron_set_viewport` | Override viewport metrics for responsive testing (`width`, `height` required) |
| `electron_scroll` | Scroll page or element (`direction`: up/down/left/right, `amount`: pixels, `selector`: optional) |

### Screenshots & Visual
| Tool | Use for |
|------|---------|
| `electron_screenshot` | Capture full page or element |
| `electron_compare_screenshots` | Byte-level diff of two screenshots (returns `diffPercent`) |
| `electron_highlight_element` | Outline element in red for 3 seconds |

## Selector Strategy (priority order)

1. `[data-testid="..."]` -- most stable
2. `[role="..."]`, `[aria-label="..."]` -- semantic
3. `.bem-class-name` -- reasonably stable
4. Element hierarchy -- last resort

## Waiting Pattern

Always wait before interacting or capturing:

```
electron_wait_for_selector  selector=".content-loaded"  timeout=10000
electron_screenshot
```

Never use arbitrary sleep/delays.

## IPC Tools

If the app uses electron-dev-bridge with configured IPC handlers, tools are named by replacing colons with underscores:

| IPC channel | MCP tool name | Preload path |
|-------------|---------------|--------------|
| `{domain}:{action}` | `{domain}_{action}` | `window.electronAPI.{domain}.{action}` |

Call IPC tools directly by name once the server is registered. Tool names depend on your app's config — e.g., `profiles_query`, `settings_get`.

## Playbook: Build & Verify

1. Make code changes
2. `electron_launch` (or restart the app)
3. `electron_wait_for_selector` on the changed element
4. `electron_screenshot` to capture current state
5. Evaluate the screenshot visually
6. If issues: fix code, restart, re-verify

## Playbook: Explore App Structure

1. `electron_connect`
2. `electron_get_accessibility_tree  maxDepth=5` to see the component hierarchy
3. `electron_query_selector_all  selector="[data-testid]"` to find test hooks
4. `electron_screenshot` for visual context
5. Use findings to plan automation or testing

## Playbook: Call IPC Handlers

1. `electron_connect`
2. Call the IPC tool directly, e.g. `profiles_query  query="test"`
3. Inspect the returned JSON
4. Use `electron_screenshot` to verify UI updated

## Screenshot Evaluation Checklist

When reviewing a screenshot, check:
- Layout: positioning, overlaps, overflow, alignment
- Text: visibility, truncation, correct content
- Colors: contrast, theme consistency
- States: hover, focus, disabled, loading, error, empty
- Responsiveness: behavior at current viewport size
