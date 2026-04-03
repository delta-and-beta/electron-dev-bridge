---
name: electron-app-dev
description: >
  Develop and automate Electron apps using the electron-dev-bridge.
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
4. Start your app with `--remote-debugging-port` (or let `electron_launch` handle it)

## Connecting

```
# Launch and auto-connect (random port if configured port is busy)
electron_launch  appPath="/path/to/{YOUR_APP}"

# Or connect to an already-running app
electron_connect
```

## Complete Tool Reference (41 tools)

### Connection & Targets
| Tool | Use for |
|------|---------|
| `electron_launch` | Launch app with debug port and connect |
| `electron_connect` | Connect to running app |
| `electron_list_targets` | List all BrowserWindows (multi-window) |
| `electron_switch_target` | Switch to a different window |

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
| `electron_type_text` | Type into input (appends to existing) |
| `electron_fill` | Clear field then type new text (replaces) |
| `electron_press_key` | Press Enter, Tab, Escape, arrows, etc. |
| `electron_select_option` | Select dropdown option by value or text |
| `electron_hover` | Hover to trigger :hover states and tooltips |

### State Reading
| Tool | Use for |
|------|---------|
| `electron_get_text` | Get innerText of element |
| `electron_get_value` | Get input/textarea/select value |
| `electron_get_attribute` | Get specific attribute |
| `electron_get_bounding_box` | Get element position and size |
| `electron_get_url` | Get current page URL |
| `electron_evaluate` | Run arbitrary JS in the renderer |
| `electron_get_page_summary` | One-call page overview (counts, errors, loading state) |
| `electron_get_form_state` | All form fields with values, labels, validation |

### Navigation & Viewport
| Tool | Use for |
|------|---------|
| `electron_navigate` | Go to a URL and wait for load |
| `electron_wait_for_selector` | Wait for element to appear (default 5s) |
| `electron_wait_for_network_idle` | Wait until no pending network requests |
| `electron_set_viewport` | Override viewport metrics |
| `electron_scroll` | Scroll page or element |

### Screenshots & Visual
| Tool | Use for |
|------|---------|
| `electron_screenshot` | Capture full page or element (via selector) |
| `electron_compare_screenshots` | Byte-level diff two screenshots |
| `electron_highlight_element` | Outline element in red for 3s |

### DevTools Capture
| Tool | Use for |
|------|---------|
| `electron_get_console_logs` | Read captured console messages |
| `electron_get_network_requests` | Read captured HTTP requests (with response bodies) |
| `electron_get_errors` | Sentry-like grouped error report |
| `electron_get_main_process_logs` | Main process stdout/stderr |
| `electron_get_devtools_stats` | Counts of captured data |
| `electron_clear_devtools_data` | Clear capture buffers |
| `electron_error_report` | Generate HTML error dashboard |

### Batch & Testing
| Tool | Use for |
|------|---------|
| `electron_execute_steps` | Run multiple actions in one call |
| `electron_assert` | Verify page conditions (text, value, URL, visible) |
| `electron_diff_state` | Before/after page state comparison |

## Recommended Workflow

### First Contact with a Page
1. `electron_get_page_summary` — understand the page structure
2. `electron_screenshot` — visual context
3. `electron_get_form_state` — if forms present
4. `electron_get_errors` — check for existing errors

### Form Automation
1. `electron_get_form_state` — discover fields
2. `electron_execute_steps` with fill/select/click actions
3. `electron_wait_for_network_idle` — wait for submission
4. `electron_assert` — verify results

### Debugging
1. `electron_get_errors` — check for exceptions
2. `electron_get_console_logs  level="error"` — renderer errors
3. `electron_get_main_process_logs  level="stderr"` — main process errors
4. `electron_get_network_requests  errorsOnly=true` — failed requests
5. `electron_error_report` — generate HTML dashboard

### Multi-Window Apps
1. `electron_list_targets` — discover all windows
2. `electron_switch_target  urlPattern="settings"` — switch to target
3. Work on that window normally
4. `electron_switch_target  urlPattern="main"` — switch back

## Selector Strategy (priority order)

1. `[data-testid="..."]` — most stable
2. `[role="..."]`, `[aria-label="..."]` — semantic
3. `.bem-class-name` — reasonably stable
4. Element hierarchy — last resort

## IPC Tools

If the app uses electron-dev-bridge with configured IPC handlers, tools are named by replacing colons with underscores. Tool names depend on your app's config — e.g., `profiles_query`, `settings_get`.
