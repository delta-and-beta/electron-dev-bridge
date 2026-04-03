---
name: electron-debugging
description: >
  Debug and troubleshoot Electron apps via electron-dev-bridge tools.
  Trigger on: debug, bug, broken, not working, UI issue, element not found,
  blank screen, can't connect, crash, stale, timeout, click not working,
  missing element, wrong text, layout broken, error tracking, sentry.
---

# Electron App Debugging with electron-dev-bridge

Systematic debugging using 41 MCP bridge tools.

## Quick Diagnostic (3 calls)

```
# 1. What's on the page?
electron_get_page_summary

# 2. Any errors?
electron_get_errors

# 3. Any failed network requests?
electron_get_network_requests  errorsOnly=true
```

If errors found, generate a full report: `electron_error_report`

## Diagnostic Flowchart

```
Problem reported
  |
  +-- Can you connect?
  |     NO  --> See "Connection Issues"
  |     YES
  |
  +-- Run electron_get_page_summary. Is UI visible?
  |     NO  --> See "Blank Screen"
  |     YES
  |
  +-- Run electron_get_errors. Any exceptions?
  |     YES --> See "Error Analysis"
  |     NO
  |
  +-- Is the expected element present?
  |     NO  --> See "Element Not Found"
  |     YES
  |
  +-- Does interaction work?
        NO  --> See "Interaction Failures"
        YES --> Issue may be data-related. Check network + IPC.
```

## Connection Issues

```
# Check port
electron_list_targets
# If no targets: app not running or wrong port

# Launch with auto-port (handles conflicts)
electron_launch  appPath="/path/to/{YOUR_APP}"

# Or connect to specific port
electron_connect  port=9230
```

| Error | Fix |
|-------|-----|
| Connection refused | Start app with `--remote-debugging-port` |
| Port in use | `electron_launch` auto-picks a free port |
| Wrong window | `electron_list_targets` then `electron_switch_target` |
| Connection lost | Auto-reconnects after 1s. If still down, `electron_connect` |

## Blank Screen

```
electron_get_url
# Is the URL correct?

electron_wait_for_selector  selector="{YOUR_APP_ROOT}"  timeout=15000
# Did it appear?

electron_get_main_process_logs  level="stderr"
# Any main process errors?

electron_get_console_logs  level="error"
# Any renderer errors?
```

## Error Analysis

```
# Grouped errors with stack traces
electron_get_errors

# Filter by source
electron_get_errors  source="exception"
electron_get_errors  source="network"
electron_get_errors  source="console.error"

# Full error report (HTML dashboard)
electron_error_report
# Opens in browser — shows grouped errors, stack traces, timeline,
# failed requests, console errors, main process logs
```

## Element Not Found

```
# What IS on the page?
electron_get_accessibility_tree  maxDepth=5

# Search by text
electron_find_by_text  text="Submit"

# Search by role
electron_find_by_role  role="button"

# Broader search
electron_query_selector_all  selector="button"

# Check for iframes
electron_query_selector_all  selector="iframe"

# Highlight a visible element to verify targeting
electron_highlight_element  selector=".some-element"
electron_screenshot
```

## Interaction Failures

```
# Verify element exists and is visible
electron_assert  assertions=[
  {"selector": "{TARGET}", "exists": true},
  {"selector": "{TARGET}", "visible": true}
]

# Check size and position
electron_get_bounding_box  selector="{TARGET}"

# Check disabled state
electron_get_attribute  selector="{TARGET}"  attribute="disabled"

# Try clicking by coordinates
electron_get_bounding_box  selector="{TARGET}"
# Use returned x + width/2, y + height/2
electron_click  x=150  y=200

# For inputs: use electron_fill instead of electron_type_text
electron_fill  selector="{TARGET}"  text="new value"
```

| Problem | Fix |
|---------|-----|
| Click no effect | Check for overlays: `electron_screenshot` |
| Type appends | Use `electron_fill` (clear + type) |
| Key press ignored | Supported: Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, Space |
| Hover not triggering | Use `electron_hover  selector="{TARGET}"` |

## Network Debugging

```
# All failed requests
electron_get_network_requests  errorsOnly=true

# Specific API endpoint
electron_get_network_requests  urlPattern="api/users"  includeBody=true

# POST requests only
electron_get_network_requests  method="POST"  includeBody=true

# Wait for network to settle
electron_wait_for_network_idle  idleTime=1000
```

## State Debugging

```
# Inspect any app state via JS
electron_evaluate  expression="window.__store__?.getState()"

# Check specific component state
electron_evaluate  expression="document.querySelector('#app').__vue__?.$data"

# Diff before/after an action
electron_diff_state  mode="snapshot"
# ... do something ...
electron_diff_state  mode="diff"
```

## Common Error Patterns

| Error | Meaning | Action |
|-------|---------|--------|
| "No target found" | No renderer connected | `electron_connect` |
| "Element not found" | Bad selector | `electron_get_accessibility_tree` |
| "Timeout waiting" | Element didn't appear | Increase timeout, check conditional rendering |
| "Context destroyed" | Page navigated | Wait for new page, retry |
| "Not connected" | CDP session expired | `electron_connect` (auto-reconnects on HMR) |
