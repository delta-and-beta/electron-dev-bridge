---
name: electron-e2e-testing
description: >
  End-to-end testing workflows for Electron apps via electron-dev-bridge.
  Trigger on: test, e2e, end-to-end, regression, form testing,
  UI verification, test flow, smoke test, integration test,
  visual regression, form fill, submit, assertion.
---

# Electron E2E Testing with electron-dev-bridge

Structured test patterns using the MCP bridge. 41 tools available.

## Test Pattern: Batch Execute + Assert

The fastest pattern — combine actions and verification in minimal calls:

```
# 1. Connect
electron_connect

# 2. Understand the page
electron_get_page_summary

# 3. Snapshot before action
electron_diff_state  mode="snapshot"

# 4. Execute steps in one call
electron_execute_steps  steps=[
  {"wait": "[data-testid='form']"},
  {"fill": {"selector": "#email", "text": "test@example.com"}},
  {"fill": {"selector": "#name", "text": "Jane Doe"}},
  {"click": "[type='submit']"},
  {"wait": ".success-message"},
  {"screenshot": true}
]

# 5. Assert results
electron_assert  assertions=[
  {"selector": ".success-message", "text": "Saved"},
  {"selector": "#email", "value": "test@example.com"},
  {"url": "/dashboard"}
]

# 6. Check what changed
electron_diff_state  mode="diff"
```

## Playbook: Form Fill & Submit

```
# 1. Discover form structure
electron_get_form_state  selector="form"

# 2. Fill all fields in one batch
electron_execute_steps  steps=[
  {"fill": {"selector": "#name", "text": "Jane Doe"}},
  {"fill": {"selector": "#email", "text": "jane@example.com"}},
  {"click": "[type='submit']"}
]

# 3. Wait for response
electron_wait_for_network_idle  idleTime=500

# 4. Assert
electron_assert  assertions=[
  {"selector": ".success", "text": "submitted"},
  {"selector": ".error", "exists": false}
]
```

## Playbook: Visual Regression

```
# Phase 1: Capture baseline
electron_connect
electron_wait_for_selector  selector="{YOUR_APP_ROOT}"
electron_screenshot
# Note the returned file path as baseline

# Phase 2: After code changes, restart
electron_launch  appPath="/path/to/{YOUR_APP}"
electron_wait_for_selector  selector="{YOUR_APP_ROOT}"
electron_screenshot
# Note the returned file path as current

# Phase 3: Compare
electron_compare_screenshots  pathA="baseline.png"  pathB="current.png"
# Returns: { identical: false, diffPercent: 0.5, totalBytes: 120000, diffBytes: 600 }
```

**Thresholds** (note: byte-level diff, not pixel-aware):
- `< 1%` diff: likely acceptable
- `1-5%` diff: review the screenshot
- `> 5%` diff: likely a regression

## Playbook: Multi-Page Flow

```
# Step 1: Login
electron_execute_steps  steps=[
  {"wait": "#login-form"},
  {"fill": {"selector": "#username", "text": "testuser"}},
  {"fill": {"selector": "#password", "text": "testpass"}},
  {"click": "[data-testid='login-btn']"},
  {"wait": "[data-testid='dashboard']"}
]

# Step 2: Assert login success
electron_assert  assertions=[
  {"selector": "[data-testid='welcome-msg']", "text": "testuser"},
  {"url": "/dashboard"}
]

# Step 3: Navigate and verify
electron_execute_steps  steps=[
  {"click": "[data-testid='settings-link']"},
  {"wait": "[data-testid='settings-page']"},
  {"screenshot": true}
]
```

## Playbook: Error Monitoring During Test

```
# Before test: clear previous errors
electron_clear_devtools_data

# Run your test actions...
electron_execute_steps  steps=[...]

# After test: check for errors
electron_get_errors
# If errors found, generate full report
electron_error_report
```

## Key Practices

- **Use `electron_execute_steps` for multi-step actions** — one call instead of many
- **Use `electron_assert` for structured verification** — pass/fail per condition
- **Use `electron_diff_state` for change detection** — snapshot before, diff after
- **Use `electron_wait_for_network_idle` after form submits** — covers async data loading
- **Use `electron_get_form_state` before filling** — discover fields, labels, validation
- **Use `electron_get_errors` after each test** — catch silent failures
- **Use `electron_error_report` for evidence** — HTML dashboard saved to disk
