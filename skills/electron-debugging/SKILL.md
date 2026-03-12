---
name: electron-debugging
description: >
  Debug and troubleshoot Electron apps via electron-mcp-sdk bridge tools.
  Trigger on: debug, bug, broken, not working, UI issue, element not found,
  blank screen, can't connect, crash, stale, timeout, click not working,
  missing element, wrong text, layout broken.
---

# Electron App Debugging with electron-mcp-sdk

Systematic debugging workflows for Electron apps using the MCP bridge.

## Diagnostic Flowchart

```
Problem reported
  |
  +-- Can you connect?
  |     NO  --> See "Connection Troubleshooting"
  |     YES
  |
  +-- Take screenshot. Is the UI visible?
  |     NO  --> See "Blank Screen / Loading Issues"
  |     YES
  |
  +-- Is the expected element present?
  |     NO  --> See "Element Not Found"
  |     YES
  |
  +-- Does interaction work?
  |     NO  --> See "Interaction Failures"
  |     YES
  |
  +-- Is the displayed content correct?
        NO  --> See "Wrong Content / State"
        YES --> Issue may be intermittent. Add waits and retry.
```

## Connection Troubleshooting

**Symptom:** `electron_connect` or `electron_launch` fails.

```
# Step 1: Verify the app is running with debug port
# (run in terminal)
lsof -i :9229

# Step 2: If no process on port, launch with debug flag
electron_launch  appPath="/path/to/{YOUR_APP}"

# Step 3: If port is in use by another process, use a different port
electron_connect  port=9230
```

| Error | Cause | Fix |
|-------|-------|-----|
| Connection refused | App not running or no debug port | Start app with `--remote-debugging-port=9229` |
| Port already in use | Another process on 9229 | Kill the process or use a different port |
| Target not found | App has no renderer window | Ensure a BrowserWindow is created |
| Connection lost mid-session | App crashed or reloaded | `electron_connect` to reconnect |

## Blank Screen / Loading Issues

**Symptom:** Screenshot shows blank or loading state.

```
# 1. Screenshot to confirm state
electron_screenshot

# 2. Check the URL -- is the app loading the right page?
electron_get_url

# 3. Wait for a known root element
electron_wait_for_selector  selector="{YOUR_APP_ROOT}"  timeout=15000

# 4. If timeout: check the accessibility tree for any content
electron_get_accessibility_tree  maxDepth=3

# 5. Re-screenshot after waiting
electron_screenshot
```

**Common causes:**
- App still loading (increase timeout)
- Wrong URL loaded (check `electron_get_url`)
- JavaScript error blocking render (check app console logs)
- Missing preload script (app can't access IPC)

## Element Not Found

**Symptom:** `electron_query_selector` returns no match.

```
# 1. Verify what IS on the page
electron_get_accessibility_tree  maxDepth=5

# 2. Search by text instead of selector
electron_find_by_text  text="Submit"

# 3. Search by role
electron_find_by_role  role="button"

# 4. Try a broader selector
electron_query_selector_all  selector="button"

# 5. Check if element is in a different part of the tree
electron_query_selector_all  selector="iframe"
# If iframes exist, the element may be inside one

# 6. Highlight a similar element to verify targeting
electron_highlight_element  selector=".some-visible-element"
electron_screenshot
```

**Common causes:**
- Selector typo or stale selector (class names changed)
- Element not yet rendered (add `electron_wait_for_selector`)
- Element inside shadow DOM or iframe
- Element conditionally rendered (check app state)

## Interaction Failures

**Symptom:** `electron_click` or `electron_type_text` has no visible effect.

```
# 1. Verify the element exists and is visible
electron_get_bounding_box  selector="{TARGET_SELECTOR}"
# Check: width/height > 0, coordinates are within viewport

# 2. Check if element is obscured by an overlay
electron_screenshot
# Look for modals, tooltips, or overlapping elements

# 3. Check element attributes
electron_get_attribute  selector="{TARGET_SELECTOR}"  attribute="disabled"
electron_get_attribute  selector="{TARGET_SELECTOR}"  attribute="readonly"

# 4. Try clicking by coordinates instead
electron_get_bounding_box  selector="{TARGET_SELECTOR}"
# Use returned x + width/2, y + height/2 as click coordinates
electron_click  x=150  y=200

# 5. For type_text: ensure element is focused
electron_click  selector="{TARGET_SELECTOR}"
electron_type_text  text="test input"
```

| Problem | Cause | Fix |
|---------|-------|-----|
| Click no effect | Overlay blocking | Dismiss the overlay first |
| Click no effect | Element disabled | Check and resolve disabled state |
| Click no effect | Wrong coordinates | Use `electron_get_bounding_box` to verify |
| Type not appearing | Element not focused | Click element first, then type |
| Type not appearing | Input is readonly | Check `readonly`/`disabled` attributes |
| Key press ignored | Wrong key name | Use exact names: `Enter`, `Tab`, `Escape`, `ArrowDown` |

## Wrong Content / State

**Symptom:** UI shows incorrect text, values, or layout.

```
# 1. Read the actual content
electron_get_text  selector="{TARGET_SELECTOR}"
electron_get_value  selector="{INPUT_SELECTOR}"

# 2. Screenshot for visual comparison
electron_screenshot

# 3. Check the accessibility tree for the full component context
electron_get_accessibility_tree  maxDepth=5

# 4. Highlight the problematic element
electron_highlight_element  selector="{TARGET_SELECTOR}"
electron_screenshot
```

## Recovery Steps

```
# 1. Screenshot current state
electron_screenshot

# 2. Reconnect if stale
electron_connect  port=9229

# 3. Check URL
electron_get_url

# 4. If app is in bad state, restart
electron_launch  appPath="/path/to/{YOUR_APP}"
electron_wait_for_selector  selector="{YOUR_APP_ROOT}"  timeout=15000
```

## Common Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No target found" | No renderer connected | `electron_connect` |
| "Selector not found" | Bad CSS selector | Use `electron_get_accessibility_tree` |
| "Timeout waiting" | Element didn't appear | Increase timeout or check conditional rendering |
| "Cannot find context" | CDP session expired | `electron_connect` again |
| "Execution context destroyed" | Page navigated | Wait for new page, retry |
