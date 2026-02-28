# Basic Test -- Counter App

A step-by-step walkthrough of testing a minimal Electron counter app using the electron-dev-bridge MCP tools.

---

## 1. Sample App Code

Create a minimal Electron app with two files:

**`counter-app/main.js`**

```js
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 400, height: 300 });
  win.loadFile('index.html');
});
```

**`counter-app/index.html`**

```html
<!DOCTYPE html>
<html>
<body>
  <h1>Counter</h1>
  <p id="count">0</p>
  <button id="increment" onclick="document.getElementById('count').textContent = parseInt(document.getElementById('count').textContent) + 1">
    Click me
  </button>
</body>
</html>
```

Make sure Electron is installed in the app directory:

```bash
cd counter-app && npm init -y && npm install electron --save-dev
```

---

## 2. MCP Configuration

Register the bridge in your project's `.claude/mcp.json`:

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

---

## 3. Tool Sequence

### Step 1: Launch the app

```
Tool: electron_launch
Args: { "appPath": "./counter-app" }
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

The bridge spawns Electron with `--remote-debugging-port=9229`, waits for startup, then connects via CDP.

---

### Step 2: Wait for the button to appear

```
Tool: electron_wait_for_selector
Args: { "selector": "#increment" }
```

Expected return:

```json
{
  "found": true,
  "selector": "#increment",
  "elapsed": 250
}
```

This polls the DOM every 250ms until the element appears. Prevents race conditions between app startup and test actions.

---

### Step 3: Screenshot the initial state

```
Tool: electron_screenshot
Args: {}
```

Expected return:

```json
{
  "path": "/absolute/path/.screenshots/screenshot-1709012345000-1.png",
  "filename": "screenshot-1709012345000-1.png",
  "base64Length": 24680,
  "selector": null
}
```

Captures the full page. The saved PNG shows the counter at 0 with the "Click me" button below it.

---

### Step 4: Verify the initial count is "0"

```
Tool: electron_get_text
Args: { "selector": "#count" }
```

Expected return:

```json
{
  "text": "0"
}
```

Reads the `innerText` of the `<p id="count">` element.

---

### Step 5: Click the increment button

```
Tool: electron_click
Args: { "selector": "#increment" }
```

Expected return:

```json
{
  "clicked": true,
  "x": 200,
  "y": 180
}
```

The bridge resolves the selector to a bounding box, calculates the center point, and dispatches mousePressed/mouseReleased events via CDP.

---

### Step 6: Verify the count is now "1"

```
Tool: electron_get_text
Args: { "selector": "#count" }
```

Expected return:

```json
{
  "text": "1"
}
```

The onclick handler incremented the counter. The text content now reflects the updated value.

---

### Step 7: Click again

```
Tool: electron_click
Args: { "selector": "#increment" }
```

Expected return:

```json
{
  "clicked": true,
  "x": 200,
  "y": 180
}
```

---

### Step 8: Verify the count is now "2"

```
Tool: electron_get_text
Args: { "selector": "#count" }
```

Expected return:

```json
{
  "text": "2"
}
```

Two clicks, counter shows 2. The test sequence confirms the increment logic works correctly.

---

### Step 9: Screenshot the final state

```
Tool: electron_screenshot
Args: {}
```

Expected return:

```json
{
  "path": "/absolute/path/.screenshots/screenshot-1709012346000-2.png",
  "filename": "screenshot-1709012346000-2.png",
  "base64Length": 24712,
  "selector": null
}
```

Captures the final state with the counter showing "2". Compare visually with the initial screenshot to confirm the UI updated.

---

## Summary

This 9-step sequence demonstrates the core test pattern:

1. **Launch** the app
2. **Wait** for the UI to be ready
3. **Screenshot** for visual evidence
4. **Read** state to assert values
5. **Interact** (click, type) to drive the UI
6. **Read** again to verify the change
7. **Screenshot** the final result

This pattern scales to any Electron app -- replace the selectors and assertions with your own app's elements.
