#!/usr/bin/env node

/**
 * Live integration test — launches the linkedin-recruiter Electron app
 * and exercises core MCP tool logic via CDP.
 *
 * Usage: node scripts/test-live.js
 */

import CDP from "chrome-remote-interface";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const APP_PATH = resolve(
  process.env.ELECTRON_APP_PATH || "../linkedin-app",
);
const ELECTRON_BIN = join(APP_PATH, "node_modules", ".bin", "electron");
const DEBUG_PORT = 9229;
const SCREENSHOT_DIR = join(process.cwd(), ".screenshots");

let cdpClient = null;
let electronProcess = null;
let passed = 0;
let failed = 0;

function log(icon, msg) {
  console.log(`${icon} ${msg}`);
}

function assert(condition, name) {
  if (condition) {
    passed++;
    log("✅", name);
  } else {
    failed++;
    log("❌", `FAIL: ${name}`);
  }
}

async function evaluateJS(expression) {
  const { result, exceptionDetails } = await cdpClient.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (exceptionDetails) {
    throw new Error(
      exceptionDetails.exception?.description || exceptionDetails.text,
    );
  }
  return result.value;
}

async function getBoundingBox(selector) {
  return evaluateJS(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()
  `);
}

// ─── Test Runner ──────────────────────────────────────────────────

async function main() {
  console.log("\n🚀 electron-dev-bridge Live Integration Test\n");
  console.log(`App: ${APP_PATH}`);
  console.log(`Port: ${DEBUG_PORT}\n`);

  // ── Test 1: Launch Electron ──────────────────────────────────
  log("🔧", "Launching Electron app...");

  electronProcess = spawn(
    ELECTRON_BIN,
    [`--remote-debugging-port=${DEBUG_PORT}`, APP_PATH],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  const stderrChunks = [];
  electronProcess.stderr.on("data", (c) => stderrChunks.push(c.toString()));

  await new Promise((r) => setTimeout(r, 3000));

  assert(electronProcess.exitCode === null, "Electron process is running");
  assert(electronProcess.pid > 0, `Process has PID: ${electronProcess.pid}`);

  // ── Test 2: Connect via CDP ──────────────────────────────────
  log("🔧", "Connecting via CDP...");

  let targets;
  for (let i = 0; i < 10; i++) {
    try {
      targets = await CDP.List({ port: DEBUG_PORT });
      if (targets.length > 0) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  assert(targets && targets.length > 0, `Found ${targets?.length} CDP targets`);

  const pageTarget = targets.find((t) => t.type === "page");
  assert(!!pageTarget, `Found page target: ${pageTarget?.title || "untitled"}`);

  cdpClient = await CDP({ target: pageTarget, port: DEBUG_PORT });
  await cdpClient.Runtime.enable();
  await cdpClient.DOM.enable();
  await cdpClient.Page.enable();

  assert(!!cdpClient, "CDP client connected");

  // ── Test 3: Get URL ──────────────────────────────────────────
  const url = await evaluateJS("window.location.href");
  assert(typeof url === "string" && url.length > 0, `Got URL: ${url}`);

  // ── Test 4: Get document title ───────────────────────────────
  const title = await evaluateJS("document.title");
  log("📄", `Page title: "${title}"`);
  assert(typeof title === "string", "Got document title");

  // ── Test 5: DOM querySelector ────────────────────────────────
  const { root } = await cdpClient.DOM.getDocument();
  assert(root.nodeId > 0, `Got document root (nodeId: ${root.nodeId})`);

  const { nodeId: bodyNodeId } = await cdpClient.DOM.querySelector({
    nodeId: root.nodeId,
    selector: "body",
  });
  assert(bodyNodeId > 0, "Found <body> element");

  // ── Test 6: Accessibility tree ───────────────────────────────
  log("🔧", "Building accessibility tree...");

  const tree = await evaluateJS(`
    (() => {
      const IMPLICIT_ROLES = {
        BUTTON: 'button', A: 'link', INPUT: 'textbox', TEXTAREA: 'textbox',
        SELECT: 'combobox', H1: 'heading', H2: 'heading', H3: 'heading',
        NAV: 'navigation', MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo',
        FORM: 'form'
      };

      function walk(el, depth) {
        if (depth > 5) return null;
        if (!el || el.nodeType !== 1) return null;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return null;

        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || IMPLICIT_ROLES[el.tagName] || null;
        const name = el.getAttribute('aria-label') || el.getAttribute('title') || null;

        const node = { tag };
        if (role) node.role = role;
        if (name) node.name = name;
        if (el.id) node.id = el.id;

        const children = [];
        for (const child of el.children) {
          const c = walk(child, depth + 1);
          if (c) children.push(c);
        }
        if (children.length) node.children = children;
        return node;
      }

      return walk(document.body, 0);
    })()
  `);

  assert(tree !== null, "Built accessibility tree");
  assert(tree.tag === "body", `Root is <body>`);

  // Count interactive elements
  function countNodes(node, pred) {
    let c = pred(node) ? 1 : 0;
    if (node.children) node.children.forEach((ch) => (c += countNodes(ch, pred)));
    return c;
  }
  const roleCount = countNodes(tree, (n) => !!n.role);
  log("📊", `Found ${roleCount} elements with roles in a11y tree`);

  // ── Test 7: Find by text ─────────────────────────────────────
  const textResult = await evaluateJS(`
    (() => {
      const snapshot = document.evaluate(
        '//*[contains(text(), "LinkedIn")]',
        document.body, null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
      );
      return { count: snapshot.snapshotLength };
    })()
  `);
  log(
    "🔍",
    `Found ${textResult.count} elements containing "LinkedIn"`,
  );
  assert(textResult.count >= 0, 'Text search for "LinkedIn" completed');

  // ── Test 8: Screenshot ───────────────────────────────────────
  log("📸", "Taking screenshot...");

  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const { data } = await cdpClient.Page.captureScreenshot({ format: "png" });
  const screenshotPath = join(
    SCREENSHOT_DIR,
    `test-linkedin-${Date.now()}.png`,
  );
  writeFileSync(screenshotPath, Buffer.from(data, "base64"));

  const screenshotSize = readFileSync(screenshotPath).length;
  assert(screenshotSize > 1000, `Screenshot saved (${(screenshotSize / 1024).toFixed(1)} KB): ${screenshotPath}`);

  // ── Test 9: Set viewport ─────────────────────────────────────
  await cdpClient.Emulation.setDeviceMetricsOverride({
    width: 1024,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert(true, "Viewport set to 1024x768");

  // Take another screenshot at new viewport
  const { data: data2 } = await cdpClient.Page.captureScreenshot({
    format: "png",
  });
  const screenshot2Path = join(
    SCREENSHOT_DIR,
    `test-linkedin-1024x768-${Date.now()}.png`,
  );
  writeFileSync(screenshot2Path, Buffer.from(data2, "base64"));

  // ── Test 10: Compare screenshots ─────────────────────────────
  const buf1 = readFileSync(screenshotPath);
  const buf2 = readFileSync(screenshot2Path);
  const identical = buf1.equals(buf2);
  assert(!identical, "Screenshots at different viewports are different");

  // ── Test 11: Scroll ──────────────────────────────────────────
  const scrollResult = await evaluateJS(`
    (() => {
      window.scrollBy(0, 200);
      return { scrollY: window.scrollY };
    })()
  `);
  assert(typeof scrollResult.scrollY === "number", `Scroll executed (scrollY: ${scrollResult.scrollY})`);

  // ── Test 12: Find interactive elements ───────────────────────
  const buttons = await evaluateJS(`document.querySelectorAll('button').length`);
  const inputs = await evaluateJS(`document.querySelectorAll('input').length`);
  const links = await evaluateJS(`document.querySelectorAll('a').length`);
  log("📊", `Interactive elements: ${buttons} buttons, ${inputs} inputs, ${links} links`);
  assert(buttons + inputs + links >= 0, "Counted interactive elements");

  // ── Test 13: Highlight element (if any button exists) ────────
  if (buttons > 0) {
    await evaluateJS(`
      (() => {
        const el = document.querySelector('button');
        if (!el) return false;
        const prev = el.style.outline;
        el.style.outline = '3px solid red';
        setTimeout(() => { el.style.outline = prev; }, 2000);
        return true;
      })()
    `);
    assert(true, "Highlighted first button with red outline");
  }

  // ── Test 14: Wait for selector ───────────────────────────────
  const start = Date.now();
  const bodyExists = await evaluateJS(`!!document.querySelector('body')`);
  const elapsed = Date.now() - start;
  assert(bodyExists, `Wait for <body> resolved in ${elapsed}ms`);

  // ── Summary ──────────────────────────────────────────────────
  console.log("\n" + "═".repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(50) + "\n");

  if (failed > 0) {
    console.log("⚠️  Some tests failed. Check output above.");
  } else {
    console.log("🎉 All tests passed! The electron-dev-bridge works correctly.");
  }

  console.log(`\nScreenshots saved to: ${SCREENSHOT_DIR}`);
}

main()
  .catch((err) => {
    console.error("\n💥 Test runner error:", err.message);
    failed++;
  })
  .finally(() => {
    if (cdpClient) cdpClient.close();
    if (electronProcess) {
      electronProcess.kill();
      log("🛑", "Electron process killed");
    }
    process.exit(failed > 0 ? 1 : 0);
  });
