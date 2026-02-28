# Visual Regression Testing

A workflow for detecting unintended visual changes in an Electron app by capturing baseline screenshots, making a code change, capturing new screenshots, and comparing them.

---

## 1. Workflow Overview

```
Phase 1: Capture Baseline
    Launch app -> Wait for content -> Screenshot (baseline)

Phase 2: Make a Code Change
    Edit CSS/HTML/JS in the app source

Phase 3: Capture Current
    Relaunch app -> Wait for content -> Screenshot (current)

Phase 4: Compare
    electron_compare_screenshots -> Interpret diff percentage

Phase 5: CI Integration (optional)
    Use screenshot-diff.js CLI in automated pipelines
```

---

## 2. Step-by-Step

### Phase 1 -- Capture Baseline

Before making any changes, capture the current state of the UI as the baseline.

**Step 1: Launch the app**

```
Tool: electron_launch
Args: { "appPath": "./my-electron-app" }
```

Expected return:

```json
{
  "pid": 12345,
  "debugPort": 9229,
  "connected": true,
  "stderr": ""
}
```

**Step 2: Wait for the main content to render**

```
Tool: electron_wait_for_selector
Args: { "selector": "#main-content", "timeout": 10000 }
```

Expected return:

```json
{
  "found": true,
  "selector": "#main-content",
  "elapsed": 500
}
```

Always wait for a known element before screenshotting. Without this, you risk capturing a blank or partially-rendered page.

**Step 3: Screenshot the baseline**

```
Tool: electron_screenshot
Args: {}
```

Expected return:

```json
{
  "path": "/Users/you/project/.screenshots/screenshot-1709012345000-1.png",
  "filename": "screenshot-1709012345000-1.png",
  "base64Length": 48200,
  "selector": null
}
```

**Save this path** -- you will need it in Phase 4 for comparison. In this example the baseline is:
`/Users/you/project/.screenshots/screenshot-1709012345000-1.png`

---

### Phase 2 -- Make a Code Change

Make the change you want to test. For example, update a CSS font-size:

**Before** (`styles.css`):

```css
.heading {
  font-size: 16px;
  color: #333;
}
```

**After** (`styles.css`):

```css
.heading {
  font-size: 20px;
  color: #333;
}
```

This is the kind of change that is hard to catch by reading code alone -- a 4px font-size increase may or may not be intentional, and its impact on layout is best verified visually.

---

### Phase 3 -- Capture Current

Relaunch the app so it picks up the code change, then take a new screenshot.

**Step 1: Relaunch the app**

If the app is still running from Phase 1, launch it again. The `electron_launch` tool will spawn a new process.

```
Tool: electron_launch
Args: { "appPath": "./my-electron-app" }
```

Expected return:

```json
{
  "pid": 12350,
  "debugPort": 9229,
  "connected": true,
  "stderr": ""
}
```

> **Note:** If the previous Electron process is still running on port 9229, you may need to terminate it first or use a different port. The tool will retry connection up to 10 times with 1-second intervals.

**Step 2: Wait for the same content**

```
Tool: electron_wait_for_selector
Args: { "selector": "#main-content", "timeout": 10000 }
```

Use the same selector as Phase 1 to ensure you are comparing equivalent states.

**Step 3: Screenshot the current state**

```
Tool: electron_screenshot
Args: {}
```

Expected return:

```json
{
  "path": "/Users/you/project/.screenshots/screenshot-1709012400000-2.png",
  "filename": "screenshot-1709012400000-2.png",
  "base64Length": 48350,
  "selector": null
}
```

The current screenshot is:
`/Users/you/project/.screenshots/screenshot-1709012400000-2.png`

---

### Phase 4 -- Compare

Use the built-in comparison tool to check if the screenshots differ.

```
Tool: electron_compare_screenshots
Args: {
  "pathA": "/Users/you/project/.screenshots/screenshot-1709012345000-1.png",
  "pathB": "/Users/you/project/.screenshots/screenshot-1709012400000-2.png"
}
```

Expected return:

```json
{
  "identical": false,
  "diffPercent": 3.42,
  "totalBytes": 48350,
  "diffBytes": 1653
}
```

#### Interpreting the results

| `diffPercent` | Meaning | Action |
|---------------|---------|--------|
| `0` (identical: true) | No visual change detected | The code change had no visible effect |
| `< 1%` | Minor difference | Likely acceptable -- sub-pixel rendering, anti-aliasing, or very small layout shift |
| `1% - 5%` | Moderate difference | Review visually -- could be an intentional change (like our font-size bump) or a subtle regression |
| `> 5%` | Significant difference | Likely a layout break, missing element, or major style regression -- investigate |

In our example, `3.42%` is expected: the heading font-size change causes text to reflow slightly, affecting a moderate portion of the page.

> **Note:** The built-in `electron_compare_screenshots` does byte-level comparison. For pixel-level comparison with configurable sensitivity, use the CLI tool in Phase 5.

---

### Phase 5 -- CI Integration

For automated pipelines, use the standalone `screenshot-diff.js` CLI tool.

#### Basic usage

```bash
node scripts/screenshot-diff.js baseline.png current.png --output diff.png --threshold 0.1
```

Arguments:
- `baseline.png` -- the baseline screenshot (positional, required)
- `current.png` -- the current screenshot (positional, required)
- `--output diff.png` -- path to write a visual diff image highlighting changed pixels (optional)
- `--threshold 0.1` -- per-pixel color distance threshold for pixelmatch (0 = exact, 1 = lenient; default: 0.1)

The tool outputs JSON to stdout:

```json
{
  "identical": false,
  "method": "pixelmatch",
  "diffPixels": 1842,
  "totalPixels": 120000,
  "diffPercent": 1.535,
  "threshold": 0.1,
  "dimensions": { "width": 400, "height": 300 }
}
```

> If `pixelmatch` and `pngjs` are not installed, the tool falls back to byte-level comparison automatically.

#### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Screenshots are identical |
| `1` | Screenshots differ |
| `2` | Error (missing file, different dimensions, etc.) |

#### CI script example

```bash
#!/bin/bash
set -e

BASELINE="./screenshots/baseline.png"
CURRENT="./screenshots/current.png"
DIFF_OUTPUT="./screenshots/diff.png"
THRESHOLD="0.1"

# Run comparison
RESULT=$(node scripts/screenshot-diff.js "$BASELINE" "$CURRENT" \
  --output "$DIFF_OUTPUT" \
  --threshold "$THRESHOLD")

echo "$RESULT"

# Parse the exit code
EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
  echo "PASS: Screenshots are identical"
elif [ $EXIT_CODE -eq 1 ]; then
  echo "FAIL: Visual regression detected"
  # Extract diffPercent for threshold checking
  DIFF_PCT=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['diffPercent'])")
  echo "Diff: ${DIFF_PCT}%"

  # Fail the build only if diff exceeds acceptable threshold
  if (( $(echo "$DIFF_PCT > 2.0" | bc -l) )); then
    echo "FAIL: Diff exceeds 2% threshold"
    exit 1
  else
    echo "WARN: Diff is within 2% tolerance -- review diff image"
    exit 0
  fi
else
  echo "ERROR: Comparison failed"
  exit 2
fi
```

This script:
1. Runs the comparison tool
2. If identical (exit 0), passes
3. If different (exit 1), checks whether the diff percentage exceeds an acceptable threshold (2% in this example)
4. Generates a diff image for human review when differences are found

---

## Tips for Visual Regression Testing

**Use consistent viewport sizes.** Set the viewport explicitly with `electron_set_viewport` before capturing screenshots to ensure consistent dimensions across runs:

```
Tool: electron_set_viewport
Args: { "width": 1280, "height": 720 }
```

**Test specific components, not just full pages.** Use the `selector` parameter on `electron_screenshot` to capture individual elements:

```
Tool: electron_screenshot
Args: { "selector": ".header-navigation" }
```

This reduces noise from unrelated parts of the page and makes diffs more meaningful.

**Wait for animations and transitions to settle.** If your app has CSS transitions, wait for the relevant element to reach its final state before screenshotting. Use `electron_wait_for_selector` with a selector that matches the post-animation state.

**Store baselines in version control.** Commit baseline screenshots alongside your code so that any team member can run the regression suite and get consistent results.
