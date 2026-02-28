# Form Automation -- Contact Form

A walkthrough of automating a contact form in an Electron app: filling text fields, selecting dropdowns, checking a checkbox, submitting, and verifying the result.

---

## 1. Sample Form HTML

The Electron app's `index.html` contains a contact form:

```html
<form id="contact-form">
  <label for="name">Name</label>
  <input type="text" id="name" name="name" required>

  <label for="email">Email</label>
  <input type="email" id="email" name="email" required>

  <label for="category">Category</label>
  <select id="category" name="category">
    <option value="">Select...</option>
    <option value="support">Support</option>
    <option value="sales">Sales</option>
    <option value="feedback">Feedback</option>
  </select>

  <label>
    <input type="checkbox" id="agree" name="agree">
    I agree to the terms
  </label>

  <button type="submit" id="submit-btn">Send</button>
  <div id="result" style="display:none">Thank you!</div>
</form>

<script>
  document.getElementById('contact-form').addEventListener('submit', function(e) {
    e.preventDefault();
    document.getElementById('result').style.display = 'block';
  });
</script>
```

---

## 2. Tool Sequence

### Step 1: Map the form structure with the accessibility tree

```
Tool: electron_get_accessibility_tree
Args: {}
```

Expected return (abbreviated):

```json
{
  "tag": "body",
  "children": [
    {
      "tag": "form",
      "role": "form",
      "id": "contact-form",
      "children": [
        { "tag": "label", "name": "Name" },
        { "tag": "input", "role": "textbox", "id": "name", "type": "text" },
        { "tag": "label", "name": "Email" },
        { "tag": "input", "role": "textbox", "id": "email", "type": "email" },
        { "tag": "label", "name": "Category" },
        { "tag": "select", "role": "combobox", "id": "category" },
        {
          "tag": "label",
          "children": [
            { "tag": "input", "role": "checkbox", "id": "agree", "type": "checkbox" }
          ]
        },
        { "tag": "button", "role": "button", "id": "submit-btn", "name": "Send" }
      ]
    }
  ]
}
```

This gives a structural overview of the form and confirms the selectors (`#name`, `#email`, `#category`, `#agree`, `#submit-btn`) are correct before interacting.

---

### Step 2: Fill in the name field

```
Tool: electron_type_text
Args: { "selector": "#name", "text": "Jane Smith" }
```

Expected return:

```json
{
  "typed": true,
  "length": 10
}
```

The tool clicks the `#name` input to focus it, then dispatches keyDown/keyUp events for each character.

---

### Step 3: Fill in the email field

```
Tool: electron_type_text
Args: { "selector": "#email", "text": "jane@example.com" }
```

Expected return:

```json
{
  "typed": true,
  "length": 16
}
```

---

### Step 4: Select a category from the dropdown

```
Tool: electron_select_option
Args: { "selector": "#category", "value": "feedback" }
```

Expected return:

```json
{
  "success": true,
  "selected": "feedback"
}
```

The tool finds the `<option>` whose `value` attribute matches `"feedback"`, sets it as the selected value, and dispatches `change` and `input` events so any JS listeners are triggered.

---

### Step 5: Check the agreement checkbox

```
Tool: electron_click
Args: { "selector": "#agree" }
```

Expected return:

```json
{
  "clicked": true,
  "x": 25,
  "y": 310
}
```

A standard click toggles the checkbox from unchecked to checked. No special tool is needed -- `electron_click` works on any interactive element.

---

### Step 6: Screenshot the filled form before submitting

```
Tool: electron_screenshot
Args: {}
```

Expected return:

```json
{
  "path": "/absolute/path/.screenshots/screenshot-1709012345000-1.png",
  "filename": "screenshot-1709012345000-1.png",
  "base64Length": 31450,
  "selector": null
}
```

Captures the form with all fields filled. This provides visual evidence of the pre-submission state -- useful for debugging if the submission fails or produces unexpected results.

---

### Step 7: Submit the form

```
Tool: electron_click
Args: { "selector": "#submit-btn" }
```

Expected return:

```json
{
  "clicked": true,
  "x": 200,
  "y": 360
}
```

Clicks the "Send" button, triggering the form's submit handler.

---

### Step 8: Wait for the result message to appear

```
Tool: electron_wait_for_selector
Args: { "selector": "#result:not([style*='display:none'])", "timeout": 5000 }
```

Expected return:

```json
{
  "found": true,
  "selector": "#result:not([style*='display:none'])",
  "elapsed": 250
}
```

The result div starts with `display:none`. After submission, the JS handler sets it to `display:block`. This selector waits for the element to become visible.

> **Alternative approach:** If the CSS selector for visibility is tricky, you can wait for the element itself (`#result`) and then read its text. If the element already exists but is hidden, use `electron_get_attribute` to check the `style` attribute.

---

### Step 9: Verify the success message

```
Tool: electron_get_text
Args: { "selector": "#result" }
```

Expected return:

```json
{
  "text": "Thank you!"
}
```

Confirms the form submission handler ran successfully and displayed the expected confirmation message.

---

## Tips for Form Automation

**Clearing existing input values:** If a field already has text, you may need to select all and overwrite it. Use `electron_click` to focus the field, then `electron_press_key` with `"key": "Home"`, followed by typing with the field focused. Alternatively, use `electron_type_text` with a `selector` -- it clicks to focus before typing.

**Validating field values after typing:** Use `electron_get_value` to read the current value of an input:

```
Tool: electron_get_value
Args: { "selector": "#email" }
```

Returns `{ "value": "jane@example.com" }`.

**Handling multi-step forms:** For wizard-style forms, repeat the pattern at each step:
1. Fill fields
2. Screenshot for evidence
3. Click "Next"
4. `electron_wait_for_selector` for the next step's content
5. Continue filling

**Verifying checkbox state:** Use `electron_get_attribute` to check the `checked` attribute:

```
Tool: electron_get_attribute
Args: { "selector": "#agree", "attribute": "checked" }
```
