---
name: electron-e2e-testing
description: >
  End-to-end testing workflows for Electron apps via electron-mcp-sdk.
  Trigger on: test, e2e, end-to-end, regression, form testing,
  UI verification, test flow, smoke test, integration test,
  visual regression, form fill, submit, assertion.
---

# Electron E2E Testing with electron-mcp-sdk

Structured test patterns for verifying Electron app behavior using the MCP bridge tools.

## Test Pattern: Launch, Wait, Act, Assert, Screenshot

Every test follows this structure:

```
1. electron_launch / electron_connect     -- establish connection
2. electron_wait_for_selector             -- wait for ready state
3. electron_click / electron_type_text    -- perform actions
4. electron_wait_for_selector             -- wait for result
5. electron_get_text / electron_get_value -- assert expected state
6. electron_screenshot                    -- capture evidence
```

## Playbook: Basic Interaction Test

**Goal:** Verify a button click produces the expected result.

```
# 1. Connect
electron_connect  port=9229

# 2. Wait for the target element
electron_wait_for_selector  selector="[data-testid='submit-btn']"  timeout=5000

# 3. Click
electron_click  selector="[data-testid='submit-btn']"

# 4. Wait for the result
electron_wait_for_selector  selector="[data-testid='result-message']"  timeout=5000

# 5. Assert
electron_get_text  selector="[data-testid='result-message']"
# Expected: "Success" or similar

# 6. Evidence
electron_screenshot
```

**Pass criteria:** `electron_get_text` returns the expected string. Screenshot shows correct UI state.

## Playbook: Form Fill & Submit

**Goal:** Complete a form and verify submission.

```
# 1. Connect and wait for form
electron_connect  port=9229
electron_wait_for_selector  selector="form"

# 2. Discover fields
electron_get_accessibility_tree  maxDepth=5

# 3. Fill text inputs
electron_type_text  selector="#name"  text="Jane Doe"
electron_type_text  selector="#email"  text="jane@example.com"

# 4. Fill dropdown
electron_select_option  selector="#role"  value="admin"

# 5. Screenshot before submit (evidence of filled state)
electron_screenshot

# 6. Submit
electron_click  selector="[type='submit']"

# 7. Wait for result
electron_wait_for_selector  selector=".success-message"  timeout=10000

# 8. Assert
electron_get_text  selector=".success-message"
# Expected: contains "submitted" or "saved"

# 9. Screenshot after submit
electron_screenshot
```

**Pass criteria:** Success message appears. Both before/after screenshots look correct.

## Playbook: Visual Regression

**Goal:** Detect unintended UI changes after a code modification.

```
# Phase 1: Capture baseline (before changes)
electron_connect  port=9229
electron_wait_for_selector  selector="{YOUR_APP_ROOT}"
electron_screenshot
# Save as baseline -- note the returned file path

# Phase 2: After making code changes, restart app
electron_launch  appPath="/path/to/{YOUR_APP}"
electron_wait_for_selector  selector="{YOUR_APP_ROOT}"
electron_screenshot
# Save as current -- note the returned file path

# Phase 3: Compare
electron_compare_screenshots  pathA="baseline.png"  pathB="current.png"
# Returns: { diffPercentage: 0.5 }
```

**Thresholds:**
- `< 1%` diff: likely acceptable (anti-aliasing, subpixel rendering)
- `1-5%` diff: review the screenshot -- may be intentional
- `> 5%` diff: likely a regression, investigate

## Playbook: Multi-Page Flow

**Goal:** Test a workflow spanning multiple views/pages.

```
# Step 1: Login page
electron_connect  port=9229
electron_wait_for_selector  selector="#login-form"
electron_type_text  selector="#username"  text="testuser"
electron_type_text  selector="#password"  text="testpass"
electron_click  selector="[data-testid='login-btn']"
electron_screenshot

# Step 2: Dashboard (after login)
electron_wait_for_selector  selector="[data-testid='dashboard']"  timeout=10000
electron_get_text  selector="[data-testid='welcome-msg']"
# Assert: contains "testuser"
electron_screenshot

# Step 3: Navigate to settings
electron_click  selector="[data-testid='settings-link']"
electron_wait_for_selector  selector="[data-testid='settings-page']"
electron_screenshot

# Step 4: Verify and return
electron_get_url
# Assert: URL contains "/settings"
```

**Pass criteria:** Each step transitions correctly. No errors. URLs and text match expectations.

## Key Practices

### Always wait, never sleep
Use `electron_wait_for_selector` between every action that changes the UI. This eliminates race conditions and makes tests deterministic.

### Screenshot at checkpoints
Capture screenshots at key moments: before actions, after actions, on errors. These serve as test evidence.

### Use data-testid selectors
Prefer `[data-testid="..."]` selectors for test stability. They survive refactors and style changes.

### Assert with get_text / get_value
Use `electron_get_text` and `electron_get_value` to verify expected content, not just visual inspection.

### Handle timeouts as failures
If `electron_wait_for_selector` times out, the element didn't appear. This is a test failure -- report it with the last screenshot for debugging context.

## IPC-Based Assertions

When the app has IPC tools configured, use them for deeper assertions:

```
# After a form submit, verify via IPC
profiles_query  query="Jane Doe"
# Assert: returned array contains the submitted profile

# Check app state directly
session_getStatus
# Assert: status is "authenticated"
```

IPC tools give you backend verification alongside UI assertions.
