# Test App

A minimal Electron app that exercises all 41 electron-dev-bridge CDP tools.

## Setup

```bash
cd test-app
npm install
```

## Run

```bash
# Start with remote debugging
npx electron . --remote-debugging-port=9229

# Or use electron_launch from Claude Code (auto-picks port)
```

## What's Inside

### Pages
- **index.html** — Main page with form, interactive elements, data table, error generators
- **settings.html** — Second window for multi-window testing

### IPC Handlers (7)
| Channel | Description |
|---------|-------------|
| `profiles:query` | Search profiles by name/email |
| `profiles:get` | Get profile by ID |
| `settings:get` | Read current settings |
| `settings:set` | Update settings |
| `tags:getAll` | List all tags |
| `tags:add` | Add a new tag |
| `app:openSettings` | Open settings window |

### Test Scenarios by Tool Category

| Category | What to test | Elements |
|----------|-------------|----------|
| **DOM Queries** | `query_selector`, `find_by_text`, `find_by_role`, `get_accessibility_tree` | Buttons, form fields, table rows, links |
| **Interaction** | `click`, `fill`, `type_text`, `press_key`, `select_option`, `hover` | Counter button, form inputs, role dropdown, tooltip trigger, toggle button |
| **State Reading** | `get_text`, `get_value`, `evaluate`, `get_page_summary`, `get_form_state` | Counter text, form values, IPC output |
| **Navigation** | `navigate`, `scroll`, `wait_for_selector` | Section A/B anchors, settings page |
| **Visual** | `screenshot`, `compare_screenshots`, `highlight_element` | Full page, element screenshots |
| **DevTools** | `get_console_logs`, `get_network_requests`, `get_errors`, `get_main_process_logs` | Error generator buttons (throw, console.error, network fail, promise reject) |
| **Batch** | `execute_steps`, `assert`, `diff_state` | Form fill → submit → verify flow |
| **Multi-Window** | `list_targets`, `switch_target` | Main window + settings window (via "Open Settings" button) |
| **Error Report** | `error_report` | Click error generators, then generate HTML report |

### Quick Test Script

```
# 1. Connect
electron_launch  appPath="./test-app"

# 2. Page overview
electron_get_page_summary

# 3. Form test
electron_execute_steps  steps=[
  {"fill": {"selector": "#name", "text": "Jane Doe"}},
  {"fill": {"selector": "#email", "text": "jane@test.com"}},
  {"click": "[data-testid='submit-btn']"},
  {"wait": "[data-testid='form-success']"}
]

# 4. Assert
electron_assert  assertions=[
  {"selector": "[data-testid='form-success']", "visible": true},
  {"selector": "[data-testid='form-success']", "text": "successfully"}
]

# 5. Error test
electron_clear_devtools_data
electron_click  selector="[data-testid='throw-error-btn']"
electron_click  selector="[data-testid='console-error-btn']"
electron_click  selector="[data-testid='network-error-btn']"
electron_get_errors
electron_error_report

# 6. Multi-window
electron_click  selector="[data-testid='open-settings-btn']"
electron_list_targets
electron_switch_target  urlPattern="settings"
electron_screenshot
```
