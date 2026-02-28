'use strict';

// ============================================================================
// Optional Preload Script for Enhanced DOM Access
// ============================================================================
//
// This is a CommonJS file (Electron requires CJS for preload scripts).
// It exposes window.__electronDevBridge with methods for accessibility tree
// inspection, text search, computed styles, scroll control, and form summary.
//
// Usage: set this as the preload script in your Electron BrowserWindow:
//   new BrowserWindow({ webPreferences: { preload: '/path/to/preload.js' } })
// ============================================================================

const { contextBridge } = require('electron');

// ============================================================================
// Implicit ARIA role mapping (tag name → role)
// ============================================================================

const IMPLICIT_ROLES = {
  BUTTON: 'button',
  A: 'link',
  INPUT: 'textbox',
  TEXTAREA: 'textbox',
  SELECT: 'combobox',
  IMG: 'img',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  NAV: 'navigation',
  MAIN: 'main',
  HEADER: 'banner',
  FOOTER: 'contentinfo',
  ASIDE: 'complementary',
  FORM: 'form',
  TABLE: 'table',
  UL: 'list',
  OL: 'list',
  LI: 'listitem',
  TR: 'row',
  TD: 'cell',
  TH: 'columnheader',
  SECTION: 'region',
  ARTICLE: 'article',
  DIALOG: 'dialog'
};

// Roles considered interactive (these elements get boundingBox data)
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'combobox', 'radio'
]);

// ============================================================================
// Default CSS properties for getComputedStyles
// ============================================================================

const DEFAULT_STYLE_PROPERTIES = [
  'display', 'position', 'width', 'height', 'margin', 'padding',
  'color', 'backgroundColor', 'fontSize', 'fontWeight', 'opacity',
  'visibility', 'overflow', 'zIndex', 'flexDirection', 'justifyContent',
  'alignItems', 'gridTemplateColumns'
];

// ============================================================================
// Helper: extract bounding box from an element
// ============================================================================

function extractBoundingBox(el) {
  var rect = el.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  };
}

// ============================================================================
// Helper: get the accessible name for an element
// ============================================================================

function getAccessibleName(el) {
  // 1. aria-label
  var name = el.getAttribute('aria-label');
  if (name) return name.slice(0, 100);

  // 2. alt attribute
  name = el.getAttribute('alt');
  if (name) return name.slice(0, 100);

  // 3. title attribute
  name = el.getAttribute('title');
  if (name) return name.slice(0, 100);

  // 4. placeholder attribute
  name = el.getAttribute('placeholder');
  if (name) return name.slice(0, 100);

  // 5. Associated label element
  if (el.id) {
    var label = document.querySelector('label[for="' + el.id + '"]');
    if (label) {
      var labelText = label.textContent.trim();
      if (labelText) return labelText.slice(0, 100);
    }
  }

  // 6. Direct text node content
  var directText = '';
  for (var i = 0; i < el.childNodes.length; i++) {
    if (el.childNodes[i].nodeType === 3) {
      directText += el.childNodes[i].textContent;
    }
  }
  directText = directText.trim();
  if (directText) return directText.slice(0, 100);

  return null;
}

// ============================================================================
// 1. getAccessibilityTree
// ============================================================================

function getAccessibilityTree(maxDepth) {
  if (maxDepth === undefined || maxDepth === null) {
    maxDepth = 10;
  }

  function walk(el, depth) {
    if (depth > maxDepth) return null;
    if (!el || el.nodeType !== 1) return null;

    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;

    var tag = el.tagName.toLowerCase();
    var role = el.getAttribute('role') || IMPLICIT_ROLES[el.tagName] || null;
    var name = getAccessibleName(el);

    var classes = el.className && typeof el.className === 'string'
      ? el.className.split(/\s+/).slice(0, 5).join(' ')
      : null;

    var node = { tag: tag };
    if (role) node.role = role;
    if (name) node.name = name;
    if (el.id) node.id = el.id;
    if (classes) node.class = classes;
    if (el.dataset && el.dataset.testid) node.dataTestId = el.dataset.testid;

    // Interactive elements get boundingBox
    if (role && INTERACTIVE_ROLES.has(role)) {
      node.boundingBox = extractBoundingBox(el);
    }

    // Interactive state
    if (el.value !== undefined && el.value !== '') {
      node.value = String(el.value).slice(0, 200);
    }
    if (el.type) node.type = el.type;
    if (el.href) node.href = el.href;
    if (el.disabled) node.disabled = true;
    if (el.checked) node.checked = true;

    var expanded = el.getAttribute('aria-expanded');
    if (expanded !== null) node.ariaExpanded = expanded;

    var selected = el.getAttribute('aria-selected');
    if (selected !== null) node.ariaSelected = selected;

    var ariaDisabled = el.getAttribute('aria-disabled');
    if (ariaDisabled !== null) node.ariaDisabled = ariaDisabled;

    // Recurse into children
    var children = [];
    for (var i = 0; i < el.children.length; i++) {
      var child = walk(el.children[i], depth + 1);
      if (child) children.push(child);
    }
    if (children.length > 0) node.children = children;

    return node;
  }

  return walk(document.body, 0);
}

// ============================================================================
// 2. findByText
// ============================================================================

function findByText(text, options) {
  if (!options) options = {};
  var tag = options.tag || '*';
  var exact = options.exact || false;
  var maxResults = options.maxResults || 50;

  // Sanitize tag: strip non-alphanumeric except *
  tag = tag.replace(/[^a-zA-Z0-9*]/g, '') || '*';

  // Build XPath expression
  var escapedText = text.replace(/"/g, '\\"');
  var xpath;
  if (exact) {
    xpath = '//' + tag + '[text()="' + escapedText + '"]';
  } else {
    xpath = '//' + tag + '[contains(text(), "' + escapedText + '")]';
  }

  var snapshot = document.evaluate(
    xpath, document.body, null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
  );

  var count = snapshot.snapshotLength;
  var limit = Math.min(count, maxResults);
  var elements = [];

  for (var i = 0; i < limit; i++) {
    var el = snapshot.snapshotItem(i);
    elements.push({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 200),
      id: el.id || null,
      className: el.className || null,
      boundingBox: extractBoundingBox(el)
    });
  }

  return { count: count, elements: elements };
}

// ============================================================================
// 3. getComputedStyles
// ============================================================================

function getComputedStyles(selector, properties) {
  var el = document.querySelector(selector);
  if (!el) return null;

  var props = properties && properties.length > 0
    ? properties
    : DEFAULT_STYLE_PROPERTIES;

  var style = window.getComputedStyle(el);
  var result = {};

  for (var i = 0; i < props.length; i++) {
    result[props[i]] = style.getPropertyValue(props[i]) || style[props[i]] || '';
  }

  return result;
}

// ============================================================================
// 4. scrollIntoView
// ============================================================================

function scrollIntoView(selector) {
  var el = document.querySelector(selector);
  if (!el) return false;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}

// ============================================================================
// 5. getFormSummary
// ============================================================================

function getFormSummary() {
  var forms = document.querySelectorAll('form');
  var result = [];

  for (var f = 0; f < forms.length; f++) {
    var form = forms[f];
    var formData = {
      index: f,
      id: form.id || null,
      action: form.action || null,
      method: form.method || null,
      fields: []
    };

    var fields = form.querySelectorAll('input, textarea, select');
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var fieldData = {
        tag: field.tagName.toLowerCase(),
        type: field.type || null,
        name: field.name || null,
        id: field.id || null,
        value: field.value || '',
        required: field.required || false,
        disabled: field.disabled || false
      };

      // If SELECT, include options
      if (field.tagName === 'SELECT') {
        var opts = [];
        for (var j = 0; j < field.options.length; j++) {
          var opt = field.options[j];
          opts.push({
            value: opt.value,
            text: opt.text,
            selected: opt.selected
          });
        }
        fieldData.options = opts;
      }

      // If has an associated label
      if (field.id) {
        var label = document.querySelector('label[for="' + field.id + '"]');
        if (label) {
          fieldData.label = label.textContent.trim();
        }
      }

      formData.fields.push(fieldData);
    }

    result.push(formData);
  }

  return result;
}

// ============================================================================
// Expose via contextBridge
// ============================================================================

contextBridge.exposeInMainWorld('__electronDevBridge', {
  getAccessibilityTree: getAccessibilityTree,
  findByText: findByText,
  getComputedStyles: getComputedStyles,
  scrollIntoView: scrollIntoView,
  getFormSummary: getFormSummary
});
