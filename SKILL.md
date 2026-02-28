---
name: electron-dev-automation
description: >
  Automate Electron app development, testing, and debugging via Claude Code.
  Provides an MCP server for DOM inspection, element interaction, screenshot
  capture and visual evaluation -- all controllable from the terminal. Use this
  skill whenever the user is building, testing, debugging, or automating an
  Electron app, even if they don't explicitly say "Electron". Trigger on:
  Electron, desktop app testing, DOM automation, screenshot-based QA,
  end-to-end desktop UI testing, BrowserWindow, webContents, or any mention
  of automating a desktop app built with web technologies.
---

# electron-dev-bridge

Drive Electron apps from Claude Code via MCP + Chrome DevTools Protocol.

## Quick Start

### Step 1: Install dependencies

```bash
cd electron-dev-bridge/scripts && npm install
```

### Step 2: Register MCP server

Add to your project's `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "electron-dev-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/electron-dev-bridge/scripts/mcp-server.js"],
      "env": {
        "ELECTRON_DEBUG_PORT": "9229",
        "SCREENSHOT_DIR": ".screenshots"
      }
    }
  }
}
```

Optional env vars: `ELECTRON_APP_PATH` (default app directory), `ELECTRON_BIN` (path to Electron binary).

### Step 3: (Optional) Add preload for enhanced DOM access

```js
new BrowserWindow({
  webPreferences: {
    preload: '/absolute/path/to/electron-dev-bridge/scripts/preload.js'
  }
});
```

The preload exposes `window.__electronDevBridge` with helpers for accessibility tree inspection, text search, computed styles, scroll control, and form summary.

### Step 4: Start using tools

Launch a new app or connect to a running one:

```
electron_launch  -- spawns Electron with --remote-debugging-port and connects
electron_connect -- connects to an already-running app on the debug port
```

---

## Architecture

```
Claude Code (terminal)
  |  MCP protocol (stdio)
  v
electron-dev-bridge (MCP server - Node.js)
  |  Chrome DevTools Protocol (CDP)
  v
Electron App (--remote-debugging-port=9229)
  +-- Main Process
  +-- Renderer Process
       +-- preload.js (optional, for enhanced DOM access)
```

---

## Tool Reference

### Connection (2 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `electron_launch` | Launch Electron app with remote debugging and connect via CDP | `appPath`, `args[]` |
| `electron_connect` | Connect to already-running Electron app | `port` (default: 9229) |

### DOM Queries (5 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `electron_query_selector` | Find one element by CSS selector; returns attributes + HTML preview | `selector` |
| `electron_query_selector_all` | Find all matching elements (up to 50); returns HTML previews | `selector` |
| `electron_find_by_text` | Find elements containing text via XPath (up to 50) | `text`, `tag` |
| `electron_find_by_role` | Find elements by ARIA role, explicit or implicit (up to 50) | `role` |
| `electron_get_accessibility_tree` | Structured a11y tree: roles, names, states, values | `maxDepth` (default: 10) |

### Interactions (4 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `electron_click` | Click element by selector or x/y coordinates | `selector` or `x`,`y` |
| `electron_type_text` | Type text into focused or targeted element | `text`, `selector` |
| `electron_press_key` | Press special key (Enter, Tab, Escape, arrows, etc.) | `key` |
| `electron_select_option` | Select option in `<select>` by value or visible text | `selector`, `value` |

### State Reading (5 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `electron_get_text` | Get innerText of an element | `selector` |
| `electron_get_value` | Get value of input/textarea/select | `selector` |
| `electron_get_attribute` | Get a specific attribute from an element | `selector`, `attribute` |
| `electron_get_bounding_box` | Get position and dimensions (x, y, width, height) | `selector` |
| `electron_get_url` | Get the current page URL | (none) |

### Navigation (3 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `electron_wait_for_selector` | Poll for element to appear; returns when found or timeout | `selector`, `timeout` (default: 5000ms) |
| `electron_set_viewport` | Set viewport dimensions for responsive testing | `width`, `height` |
| `electron_scroll` | Scroll page or element in a direction | `direction`, `amount`, `selector` |

### Screenshots (3 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `electron_screenshot` | Capture full page or element screenshot; saves PNG to disk | `selector`, `fullPage` |
| `electron_compare_screenshots` | Byte-level comparison of two screenshot files; returns diff % | `pathA`, `pathB` |
| `electron_highlight_element` | Temporarily outline element in red (3s) for visual identification | `selector` |

> See `references/tools-api.md` for full parameter and return value documentation.

---

## Operational Playbooks

### 1. Build and Verify UI Feature

**When:** After making code changes, verify they render correctly.

1. Make code changes to the Electron app
2. `electron_launch` (or restart if already running)
3. `electron_wait_for_selector` on the key element you changed
4. `electron_screenshot` to capture the current state
5. Visually evaluate the screenshot for correctness
6. If issues found: fix code, restart app, re-verify

### 2. End-to-End Interaction Test

**When:** Testing user flows such as login, form submission, or navigation.

1. `electron_launch` to start the app
2. `electron_wait_for_selector` for the first interactive element
3. Perform actions: `electron_click`, `electron_type_text`, `electron_press_key`
4. After each action, `electron_wait_for_selector` for the expected next state
5. `electron_screenshot` at key checkpoints
6. `electron_get_text` / `electron_get_value` to assert expected content
7. Report pass/fail with evidence

### 3. Visual Regression Test

**When:** Ensuring CSS or layout changes do not break existing UI.

1. Before changes: `electron_screenshot` to capture baseline images
2. Make CSS/layout changes
3. Restart the app
4. `electron_screenshot` to capture new images
5. `electron_compare_screenshots` between baseline and new
6. Flag any regressions above acceptable diff threshold

### 4. Debug a UI Bug

**When:** A user reports a visual or functional UI issue.

1. `electron_launch` to reproduce the environment
2. `electron_screenshot` to see the current state
3. `electron_get_accessibility_tree` to understand the DOM structure
4. Use JS evaluation (via CDP) to inspect component state if needed
5. Identify the root cause from DOM/visual evidence
6. Fix the code, restart, and verify the fix with a new screenshot

### 5. Form Automation

**When:** Testing or automating form fills and submissions.

1. `electron_get_accessibility_tree` to discover form fields
2. `electron_type_text` into each text input (with `selector`)
3. `electron_select_option` for dropdown fields
4. `electron_screenshot` before submission to document the filled form
5. `electron_click` on the submit button
6. `electron_wait_for_selector` on the result/confirmation element
7. `electron_get_text` to verify the success message or result

> See `references/playbooks.md` for expanded versions with error handling and edge cases.

---

## Screenshot Evaluation Guide

When evaluating a captured screenshot, check for:

- **Layout:** Element positioning, overlaps, overflow, alignment issues
- **Text:** Visibility, truncation, readability, correct content
- **Colors/theme:** Contrast ratios, design system compliance
- **Interactive states:** Hover, focus, disabled appearance
- **Responsiveness:** Proper behavior at the current viewport size
- **Empty/loading/error states:** Correct fallback display

---

## Selector Strategy

Use selectors in this priority order (most stable first):

1. **`data-testid`** -- Most stable; explicit test hook that won't change with refactors
2. **ARIA roles/labels** -- Semantic and accessibility-friendly (`[role="dialog"]`, `[aria-label="Close"]`)
3. **Stable CSS classes** (BEM or similar) -- Reasonably stable across refactors
4. **Element hierarchy** -- Least stable; avoid unless no alternative

---

## Waiting Strategy

Always use `electron_wait_for_selector` instead of arbitrary sleep/delays.

- Eliminates race conditions between test steps and rendering
- Makes tests deterministic regardless of machine speed
- Faster execution (returns immediately when element appears)
- Provides clear timeout errors with actionable messages

Example pattern:
```
electron_wait_for_selector  selector=".modal-content"  timeout=10000
electron_screenshot
```

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Cannot connect to app | App not launched with `--remote-debugging-port`, wrong port, or port in use | Verify launch flags; check `lsof -i :9229`; try a different port |
| Element not found | Selector wrong, element not yet rendered, or inside shadow DOM/iframe | Use `electron_get_accessibility_tree` to inspect what is actually rendered |
| Blank screenshot | Page not fully loaded when screenshot was taken | Add `electron_wait_for_selector` before screenshot to ensure content is present |
| Stale connection | App reloaded or crashed | Use `electron_connect` to re-establish the CDP connection |
| Click has no effect | Element obscured by overlay, or coordinates are off-screen | Use `electron_get_bounding_box` to verify position; check for modals/overlays |
| Type text not appearing | Element not focused, or input blocked by JS event handler | Provide `selector` param to auto-focus; check for `readonly`/`disabled` attributes |
