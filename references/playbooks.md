# Operational Playbooks

Expanded step-by-step procedures for common electron-dev-bridge workflows.
Each playbook shows exact tool calls with realistic parameters, decision points,
and error handling guidance.

> **Prerequisites for all playbooks:**
> - MCP server is registered in `.claude/mcp.json`
> - Dependencies installed (`cd electron-dev-bridge/scripts && npm install`)
> - Electron app has the preload configured (optional but recommended)

> **Selector strategy (priority order):**
> 1. `[data-testid="..."]` -- most stable, explicit test hook
> 2. ARIA roles/labels -- `[role="dialog"]`, `[aria-label="Close"]`
> 3. Stable CSS classes (BEM) -- `.nav__item`, `.form-field__input`
> 4. Element hierarchy -- least stable, use as last resort

> **Waiting strategy:** Always use `electron_wait_for_selector` instead of
> arbitrary delays. It polls every 250ms, returns immediately when the element
> appears, and gives a clear timeout error if it does not.

---

## Playbook 1: Build and Verify UI Feature

**When:** After making code changes to an Electron app, verify they render correctly.

### Step 1: Make code changes

Edit the relevant source files in the Electron app. For example, adding a new
settings panel component.

### Step 2: Launch the app

```
electron_launch
  appPath: "/path/to/my-electron-app"
```

**Returns:** `{ pid, debugPort: 9229, connected: true }`

**If this fails:**
- `"Electron process exited immediately"` -- check that `appPath` points to a
  directory with a valid `package.json` and that Electron is installed there.
- `"Failed to connect to CDP"` -- the app started but no page loaded yet. The
  app may have a splash screen or slow initialization. Retry with
  `electron_connect` after a few seconds.

### Step 3: Wait for the key UI element

```
electron_wait_for_selector
  selector: "[data-testid=\"settings-panel\"]"
  timeout: 10000
```

**Returns:** `{ found: true, selector: "...", elapsed: 1250 }`

**If this times out:**
- The element may not exist. Use `electron_get_accessibility_tree` with
  `maxDepth: 5` to see what actually rendered.
- The selector may be wrong. Double-check the component source for the correct
  `data-testid` value, or fall back to a class or tag selector.

### Step 4: Capture a screenshot

```
electron_screenshot
  selector: "[data-testid=\"settings-panel\"]"
```

**Returns:** `{ path: ".screenshots/screenshot-1709012345-1.png", filename: "...", selector: "..." }`

To capture the full page instead of just the element:

```
electron_screenshot
  fullPage: true
```

### Step 5: Evaluate the screenshot

Review the captured image against this checklist:

- **Layout:** Is the element positioned correctly? Any overlaps or overflow?
- **Text:** Is all text visible, readable, and not truncated?
- **Colors/theme:** Do colors match the design system? Sufficient contrast?
- **Interactive states:** Do buttons, inputs, and links look correct in their
  default state?
- **Responsiveness:** Does the layout fit the current viewport without
  horizontal scrolling?
- **Empty/loading/error states:** If applicable, does the fallback display
  correctly?

### Step 6: Decision point

**If the screenshot looks correct:**
- The feature is verified. Document the screenshot path as evidence.

**If something looks wrong:**
1. Identify the issue from the screenshot (e.g., text is clipped, wrong color,
   misaligned element).
2. Fix the code in the source file.
3. Kill the running Electron process (it will be replaced on next launch).
4. Re-launch:
   ```
   electron_launch
     appPath: "/path/to/my-electron-app"
   ```
5. Wait again:
   ```
   electron_wait_for_selector
     selector: "[data-testid=\"settings-panel\"]"
     timeout: 10000
   ```
6. Screenshot again:
   ```
   electron_screenshot
     selector: "[data-testid=\"settings-panel\"]"
   ```
7. Re-evaluate. Repeat this fix-launch-verify loop until the screenshot passes
   the evaluation checklist.

---

## Playbook 2: End-to-End Interaction Test

**When:** Testing a complete user flow such as login, search, or multi-step form.

This example tests a login flow: enter credentials, submit, verify the dashboard
loads.

### Step 1: Launch the app

```
electron_launch
  appPath: "/path/to/my-electron-app"
```

### Step 2: Wait for the login form

```
electron_wait_for_selector
  selector: "[data-testid=\"login-form\"]"
  timeout: 10000
```

**If this times out:** The app may have loaded to a different page (e.g., already
logged in, or an error page). Take a diagnostic screenshot:
```
electron_screenshot
  fullPage: true
```
Then use `electron_get_url` to check what page loaded and adjust accordingly.

### Step 3: Enter the username

```
electron_type_text
  selector: "#username"
  text: "testuser@example.com"
```

**Verify the value was entered:**
```
electron_get_value
  selector: "#username"
```

**Decision:** If the returned `value` is `"testuser@example.com"` -- proceed.
If the value is empty or wrong -- the input may be read-only, disabled, or
blocked by a JS handler. Check with:
```
electron_get_attribute
  selector: "#username"
  attribute: "disabled"
```

### Step 4: Enter the password

```
electron_type_text
  selector: "#password"
  text: "s3cure-p@ss"
```

**Verify:**
```
electron_get_value
  selector: "#password"
```

### Step 5: Screenshot before submission (evidence)

```
electron_screenshot
  fullPage: true
```

This documents the state of the form immediately before clicking submit.

### Step 6: Click the submit button

```
electron_click
  selector: "[data-testid=\"submit-btn\"]"
```

### Step 7: Wait for navigation result

```
electron_wait_for_selector
  selector: "[data-testid=\"dashboard\"]"
  timeout: 15000
```

**Decision point -- if the dashboard selector is found:**
- Login succeeded. Proceed to verification.

**If it times out:**
- Check for an error message instead:
  ```
  electron_wait_for_selector
    selector: "[data-testid=\"login-error\"]"
    timeout: 3000
  ```
- If the error element exists, read its content:
  ```
  electron_get_text
    selector: "[data-testid=\"login-error\"]"
  ```
- **If text contains "Invalid credentials"** -- the test credentials are wrong.
  Update them and retry from Step 3.
- **If text contains "Network error"** -- the backend is unreachable. This is an
  environment issue, not a UI bug.
- **If neither dashboard nor error appears** -- take a screenshot to see what
  state the app is in:
  ```
  electron_screenshot
    fullPage: true
  ```

### Step 8: Verify dashboard content

```
electron_get_text
  selector: "[data-testid=\"welcome-message\"]"
```

**Decision:** If the text contains `"Welcome, testuser"` -- PASS.
If the text is empty or shows a different user -- FAIL, investigate the
authentication flow.

### Step 9: Screenshot the final state

```
electron_screenshot
  fullPage: true
```

### Step 10: Report

Format the result as:

```
## Login E2E Test Result

**Status:** PASS / FAIL
**Timestamp:** <current time>

### Steps Executed
1. Launched app -- OK
2. Login form rendered -- OK (waited 1250ms)
3. Entered username -- OK (verified value)
4. Entered password -- OK (verified value)
5. Clicked submit -- OK
6. Dashboard loaded -- OK / FAIL (timeout after 15000ms)
7. Welcome message correct -- OK ("Welcome, testuser") / FAIL (got "...")

### Evidence
- Pre-submit screenshot: .screenshots/screenshot-...-1.png
- Post-login screenshot: .screenshots/screenshot-...-2.png

### Failures (if any)
- Step N failed: <description of what happened vs. what was expected>
```

---

## Playbook 3: Visual Regression Test

**When:** Ensuring that CSS, layout, or dependency changes do not break existing UI.

### Step 1: Capture baseline screenshots (before changes)

Launch the app on the current/main branch:

```
electron_launch
  appPath: "/path/to/my-electron-app"
```

Wait for the app to fully render:

```
electron_wait_for_selector
  selector: "[data-testid=\"app-root\"]"
  timeout: 10000
```

Capture baselines for each critical view. Use descriptive filenames by
screenshotting distinct areas:

**View 1 -- Header:**
```
electron_screenshot
  selector: "[data-testid=\"app-header\"]"
```
Note the returned path (e.g., `.screenshots/screenshot-1709012345-1.png`).
Rename or record it as the "header baseline."

**View 2 -- Sidebar:**
```
electron_screenshot
  selector: "[data-testid=\"sidebar-nav\"]"
```

**View 3 -- Main content area:**
```
electron_screenshot
  selector: "[data-testid=\"main-content\"]"
```

**View 4 -- Full page:**
```
electron_screenshot
  fullPage: true
```

### Step 2: Make code changes

Edit CSS, update dependencies, refactor layout components, etc.

### Step 3: Kill and re-launch

The previous Electron process must be stopped so the new code is loaded.
Launch again:

```
electron_launch
  appPath: "/path/to/my-electron-app"
```

Wait for the app:

```
electron_wait_for_selector
  selector: "[data-testid=\"app-root\"]"
  timeout: 10000
```

### Step 4: Capture "current" screenshots of the same views

Capture the exact same selectors as Step 1:

```
electron_screenshot
  selector: "[data-testid=\"app-header\"]"
```

```
electron_screenshot
  selector: "[data-testid=\"sidebar-nav\"]"
```

```
electron_screenshot
  selector: "[data-testid=\"main-content\"]"
```

```
electron_screenshot
  fullPage: true
```

### Step 5: Compare each pair

For each baseline/current pair, run the comparison tool:

**Header comparison:**
```
electron_compare_screenshots
  pathA: ".screenshots/screenshot-1709012345-1.png"
  pathB: ".screenshots/screenshot-1709012345-5.png"
```

**Returns:** `{ identical: false, diffPercent: 0.03, totalBytes: 245760, diffBytes: 74 }`

**Sidebar comparison:**
```
electron_compare_screenshots
  pathA: ".screenshots/screenshot-1709012345-2.png"
  pathB: ".screenshots/screenshot-1709012345-6.png"
```

**Main content comparison:**
```
electron_compare_screenshots
  pathA: ".screenshots/screenshot-1709012345-3.png"
  pathB: ".screenshots/screenshot-1709012345-7.png"
```

**Full page comparison:**
```
electron_compare_screenshots
  pathA: ".screenshots/screenshot-1709012345-4.png"
  pathB: ".screenshots/screenshot-1709012345-8.png"
```

### Step 6: Interpret results

Apply these thresholds to the `diffPercent` value from each comparison:

| diffPercent | Verdict | Action |
|-------------|---------|--------|
| `< 0.1` | **PASS** | No visible regression. Sub-pixel rendering differences are normal. |
| `0.1 - 5.0` | **NEEDS REVIEW** | Possibly intentional change, possibly a subtle regression. Take a closer look at the screenshots side by side. If the change is intentional, update the baseline. |
| `> 5.0` | **DEFINITE REGRESSION** | Significant visual change detected. Investigate which elements shifted, compare the DOM structure, and fix before merging. |

**Decision:**
- **If all views pass (< 0.1%):** The CSS/layout changes are safe. Proceed.
- **If any view needs review (0.1-5%):** Open both screenshots side by side.
  Check whether the difference is in the area you intentionally changed or in an
  unrelated area. If unrelated -- it is a regression.
- **If any view is a definite regression (> 5%):** Do NOT merge. Fix the
  regression, re-launch, re-capture, and re-compare.

### Step 7 (alternative): CLI comparison

For more precise pixel-level comparison (requires `pixelmatch` and `pngjs`
installed), use the standalone CLI tool:

```bash
node scripts/screenshot-diff.js \
  .screenshots/screenshot-1709012345-1.png \
  .screenshots/screenshot-1709012345-5.png \
  --output .screenshots/header-diff.png \
  --threshold 0.1
```

This produces:
- `diffPixels` / `totalPixels` -- exact pixel count
- `diffPercent` -- percentage based on pixel comparison (more accurate than
  byte-level)
- A visual diff image at `--output` path showing changed pixels highlighted in
  magenta

The CLI exits with code 0 if identical, code 1 if different, code 2 on error.

---

## Playbook 4: Debug a UI Bug

**When:** A user reports a visual or functional UI issue (e.g., "the Save button
is invisible" or "the sidebar overlaps the content").

### Step 1: Reproduce the environment

```
electron_launch
  appPath: "/path/to/my-electron-app"
```

If the bug requires a specific viewport size:
```
electron_set_viewport
  width: 1024
  height: 768
```

If the bug requires navigating to a specific page, use interactions to get there
(click nav items, etc.).

### Step 2: See the current state

```
electron_screenshot
  fullPage: true
```

Review the screenshot. Does the bug reproduce? If not, the issue may be
state-dependent (e.g., requires data to be loaded, or a specific user action
sequence).

### Step 3: Understand the DOM structure

```
electron_get_accessibility_tree
  maxDepth: 8
```

This returns a structured tree showing every visible element with its role, name,
id, class, value, and state. Scan the tree for:
- Is the reported element present in the tree at all?
- Does it have the expected role and name?
- Is it marked `disabled` or `ariaDisabled: "true"` unexpectedly?

### Step 4: Inspect the specific problem element

**Read the element's text:**
```
electron_get_text
  selector: "[data-testid=\"save-btn\"]"
```

**Read the element's current value (for inputs):**
```
electron_get_value
  selector: "#email-input"
```

**Check CSS classes for clues:**
```
electron_get_attribute
  selector: "[data-testid=\"save-btn\"]"
  attribute: "class"
```

**Decision:** If the class list includes something like `"btn btn--hidden"` or
`"btn btn--disabled"` -- that explains the visual issue. The bug is in the logic
that applies those classes.

**Check inline styles:**
```
electron_get_attribute
  selector: "[data-testid=\"save-btn\"]"
  attribute: "style"
```

**Decision:** If the style contains `display: none` or `visibility: hidden` or
`opacity: 0` -- the element is being hidden by inline styles, likely set by JS.

**Check dimensions and position:**
```
electron_get_bounding_box
  selector: "[data-testid=\"save-btn\"]"
```

**Returns:** `{ x: 0, y: 0, width: 0, height: 0 }`

**Decision:** If width or height is 0 -- the element has collapsed. Check its
parent container or CSS for `overflow: hidden`, `max-height: 0`, or missing
content.

### Step 5: Form a hypothesis and test with JS evaluation

Based on the evidence gathered, form a hypothesis. For example: "The save button
is hidden because `appState.canSave` is false."

Test by evaluating JavaScript directly in the renderer. The MCP server's
internal `evaluateJS` function uses `Runtime.evaluate` via CDP. You can use
any tool that triggers JS evaluation to probe state:

```
electron_get_text
  selector: "body"
```

Or use `electron_find_by_text` to search for error messages that might be
hidden or off-screen:
```
electron_find_by_text
  text: "Error"
  tag: "span"
```

To check computed styles, use `electron_get_attribute` on a data attribute you
set via the preload's helpers, or inspect the accessibility tree for state
changes.

### Step 6: Highlight the problem element

```
electron_highlight_element
  selector: "[data-testid=\"save-btn\"]"
```

This adds a 3-second red outline around the element. Immediately screenshot:
```
electron_screenshot
  fullPage: true
```

This visually confirms which element you are investigating and its position
relative to surrounding elements.

### Step 7: Fix the code

Based on the evidence:
- If a CSS class is wrong -- fix the conditional logic that applies it.
- If an inline style hides the element -- fix the JS that sets it.
- If the element has zero dimensions -- fix the CSS layout rules.
- If the element is missing from the DOM entirely -- fix the render condition.

### Step 8: Verify the fix

Re-launch with the fixed code:

```
electron_launch
  appPath: "/path/to/my-electron-app"
```

Wait for the app to load:
```
electron_wait_for_selector
  selector: "[data-testid=\"app-root\"]"
  timeout: 10000
```

Verify the element is now visible:
```
electron_wait_for_selector
  selector: "[data-testid=\"save-btn\"]"
  timeout: 5000
```

Check its dimensions:
```
electron_get_bounding_box
  selector: "[data-testid=\"save-btn\"]"
```

**Decision:** If width > 0 and height > 0 -- the element is rendering.

Screenshot for final evidence:
```
electron_screenshot
  fullPage: true
```

Compare with the original bug screenshot to confirm the fix.

### Step 9: Report

```
## Bug Fix Verification

**Bug:** Save button invisible on settings page
**Root cause:** CSS class `btn--hidden` applied when `canSave` was `undefined`
  (falsy) instead of explicitly `false`.
**Fix:** Changed condition from `if (!canSave)` to `if (canSave === false)`

### Evidence
- Bug state screenshot: .screenshots/screenshot-...-1.png
- Accessibility tree showed element present but with class "btn btn--hidden"
- Bounding box confirmed 0x0 dimensions
- After fix, bounding box shows 120x40 dimensions
- Fixed state screenshot: .screenshots/screenshot-...-3.png
```

---

## Playbook 5: Form Automation

**When:** Testing or automating form fills and submissions (registration, settings,
data entry).

This example automates a user registration form with text fields, a dropdown,
checkboxes, and a submit button.

### Step 1: Discover form structure

Launch the app and navigate to the form:

```
electron_launch
  appPath: "/path/to/my-electron-app"
```

```
electron_wait_for_selector
  selector: "[data-testid=\"registration-form\"]"
  timeout: 10000
```

Get the accessibility tree to discover all form fields:

```
electron_get_accessibility_tree
  maxDepth: 6
```

Examine the returned tree. You are looking for:
- **Textbox** roles -- these are text inputs and textareas
- **Combobox** roles -- these are `<select>` dropdowns
- **Checkbox** roles -- these are checkboxes
- **Button** roles -- look for the submit button

Example tree excerpt:
```json
{
  "tag": "form",
  "role": "form",
  "id": "registration-form",
  "children": [
    { "tag": "input", "role": "textbox", "type": "text", "id": "first-name", "name": "First Name" },
    { "tag": "input", "role": "textbox", "type": "text", "id": "last-name", "name": "Last Name" },
    { "tag": "input", "role": "textbox", "type": "email", "id": "email", "name": "Email" },
    { "tag": "input", "role": "textbox", "type": "password", "id": "password", "name": "Password" },
    { "tag": "select", "role": "combobox", "id": "country", "name": "Country" },
    { "tag": "input", "role": "checkbox", "type": "checkbox", "id": "terms", "name": "I agree to the terms" },
    { "tag": "button", "role": "button", "dataTestId": "submit-btn", "name": "Register" }
  ]
}
```

### Step 2: Fill text fields

For each text input, use `electron_type_text` with the field's selector.

**First name:**
```
electron_type_text
  selector: "#first-name"
  text: "Jane"
```

**Last name:**
```
electron_type_text
  selector: "#last-name"
  text: "Doe"
```

**Email:**
```
electron_type_text
  selector: "#email"
  text: "jane.doe@example.com"
```

**Password:**
```
electron_type_text
  selector: "#password"
  text: "Str0ng-P@ssw0rd!"
```

### Step 3: Verify text field values

After filling all text fields, spot-check that values were entered correctly:

```
electron_get_value
  selector: "#first-name"
```

**Decision:** If value is `"Jane"` -- proceed. If value is empty or garbled --
the input may have had a JS handler that interfered (e.g., auto-formatting or
masking). Try clicking the field first, clearing it with select-all + delete,
then retyping:

```
electron_click
  selector: "#first-name"
```
```
electron_press_key
  key: "Home"
```
Then shift-select-all and delete, or use triple-click to select all text in the
field before retyping.

```
electron_get_value
  selector: "#email"
```

**Decision:** If value is `"jane.doe@example.com"` -- proceed.

### Step 4: Select dropdown value

```
electron_select_option
  selector: "select[name=\"country\"]"
  value: "US"
```

**Returns:** `{ success: true, selected: "US" }`

**If the option is not found by value, try visible text:**
```
electron_select_option
  selector: "select[name=\"country\"]"
  value: "United States"
```

**Verify the selection:**
```
electron_get_value
  selector: "select[name=\"country\"]"
```

**Decision:** If value is `"US"` -- proceed. If value is still the default
(e.g., `""` or `"--"`) -- the dropdown may use a custom widget instead of a
native `<select>`. In that case, fall back to click-based interaction:
1. Click the dropdown trigger to open it.
2. Use `electron_wait_for_selector` for the option list to appear.
3. Use `electron_click` on the specific option element.

### Step 5: Toggle checkboxes

```
electron_click
  selector: "#terms"
```

**Verify the checkbox state:**
```
electron_get_attribute
  selector: "#terms"
  attribute: "checked"
```

**Decision:** If the attribute is present (value is `""` or `"true"`) -- the
checkbox is checked. If the attribute is `null` -- the click did not register.
Check if there is a label wrapping the checkbox that intercepts the click:
```
electron_click
  selector: "label[for=\"terms\"]"
```

### Step 6: Screenshot before submission

Capture evidence of the filled form:

```
electron_screenshot
  selector: "[data-testid=\"registration-form\"]"
```

This screenshot documents the exact state of all fields before submission.
Review it:
- Are all fields populated?
- Is the correct country selected in the dropdown?
- Is the terms checkbox checked?

### Step 7: Submit the form

```
electron_click
  selector: "[data-testid=\"submit-btn\"]"
```

### Step 8: Wait for the result

**Success path:**
```
electron_wait_for_selector
  selector: "[data-testid=\"registration-success\"]"
  timeout: 10000
```

**If success element appears:**
```
electron_get_text
  selector: "[data-testid=\"registration-success\"]"
```

**Decision:** If text contains `"Registration successful"` or
`"Welcome, Jane"` -- PASS.

**If timeout:**
Check for validation errors:
```
electron_wait_for_selector
  selector: ".form-error, [data-testid=\"form-error\"], [role=\"alert\"]"
  timeout: 3000
```

If an error element is found:
```
electron_get_text
  selector: ".form-error"
```

**Decision based on error text:**
- `"Email already registered"` -- test data conflict; use a different email.
- `"Password must contain..."` -- password did not meet requirements; update the
  password value and retry from Step 2 (password field only).
- `"Please accept the terms"` -- the checkbox click did not register; retry
  Step 5.
- `"Invalid email format"` -- the email was not typed correctly; clear and
  retype.

### Step 9: Screenshot the result

```
electron_screenshot
  fullPage: true
```

### Step 10: Report

```
## Form Automation Test Result

**Form:** User Registration
**Status:** PASS / FAIL

### Fields Filled
| Field     | Selector               | Value                    | Verified |
|-----------|------------------------|--------------------------|----------|
| First Name| #first-name            | Jane                     | Yes      |
| Last Name | #last-name             | Doe                      | Yes      |
| Email     | #email                 | jane.doe@example.com     | Yes      |
| Password  | #password              | (masked)                 | Yes      |
| Country   | select[name="country"] | US                       | Yes      |
| Terms     | #terms                 | checked                  | Yes      |

### Submission Result
- Success message: "Registration successful! Welcome, Jane."
- Time to result: ~2500ms

### Evidence
- Filled form screenshot: .screenshots/screenshot-...-1.png
- Result screenshot: .screenshots/screenshot-...-2.png
```

---

## Quick Reference: Common Decision Patterns

### "Element not found" after wait timeout

1. `electron_get_accessibility_tree` with `maxDepth: 5` -- see what is actually rendered.
2. `electron_screenshot` -- visually confirm the page state.
3. `electron_get_url` -- verify you are on the expected page.
4. Adjust the selector or navigate to the correct page.

### "Click has no effect"

1. `electron_get_bounding_box` on the target -- verify it has non-zero dimensions.
2. `electron_screenshot` -- check if the element is obscured by an overlay or modal.
3. Try clicking by coordinates if the selector-based click misses:
   ```
   electron_click
     x: 350
     y: 200
   ```
4. Check for `pointer-events: none` via `electron_get_attribute` on `style`.

### "Typed text does not appear"

1. Verify the element is not `disabled` or `readonly`:
   ```
   electron_get_attribute
     selector: "#my-input"
     attribute: "disabled"
   ```
2. Provide the `selector` parameter to `electron_type_text` so it clicks to
   focus first.
3. Some inputs need a clear before typing (e.g., pre-populated fields). Click
   the field, press `Home`, then hold Shift + press `End` to select all, then
   type the new value.

### "Screenshot is blank"

1. Always `electron_wait_for_selector` before taking a screenshot.
2. The page may still be loading async content. Wait for a content element, not
   just the container:
   ```
   electron_wait_for_selector
     selector: "[data-testid=\"content-loaded\"]"
     timeout: 15000
   ```
3. Check `electron_get_url` -- you may be on `about:blank` or an error page.
