#!/usr/bin/env node

// ============================================================================
// Standalone CLI tool for comparing two screenshot images
// ============================================================================
// Usage: node screenshot-diff.js <baseline.png> <current.png> [--output diff.png] [--threshold 0.1]

import { readFileSync, writeFileSync } from "node:fs";

// ============================================================================
// Parse CLI arguments
// ============================================================================

const args = process.argv.slice(2);
const positional = [];
let outputPath = null;
let threshold = 0.1;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--output" && i + 1 < args.length) {
    outputPath = args[++i];
  } else if (args[i] === "--threshold" && i + 1 < args.length) {
    threshold = parseFloat(args[++i]);
  } else if (!args[i].startsWith("--")) {
    positional.push(args[i]);
  }
}

if (positional.length < 2) {
  console.error(
    "Usage: screenshot-diff <baseline.png> <current.png> [--output diff.png] [--threshold 0.1]",
  );
  process.exit(2);
}

const [baselinePath, currentPath] = positional;

// ============================================================================
// Compare screenshots
// ============================================================================

try {
  let result;

  try {
    // Try pixel-level comparison with pixelmatch + pngjs
    const { default: pixelmatch } = await import("pixelmatch");
    const { PNG } = await import("pngjs");

    const baselineBuffer = readFileSync(baselinePath);
    const currentBuffer = readFileSync(currentPath);

    const baselinePng = PNG.sync.read(baselineBuffer);
    const currentPng = PNG.sync.read(currentBuffer);

    if (
      baselinePng.width !== currentPng.width ||
      baselinePng.height !== currentPng.height
    ) {
      result = {
        identical: false,
        method: "pixelmatch",
        error: `Different dimensions: baseline=${baselinePng.width}x${baselinePng.height}, current=${currentPng.width}x${currentPng.height}`,
        dimensions: {
          baseline: {
            width: baselinePng.width,
            height: baselinePng.height,
          },
          current: {
            width: currentPng.width,
            height: currentPng.height,
          },
        },
      };
    } else {
      const { width, height } = baselinePng;
      const totalPixels = width * height;
      const diffImage = new PNG({ width, height });

      const diffPixels = pixelmatch(
        baselinePng.data,
        currentPng.data,
        diffImage.data,
        width,
        height,
        { threshold },
      );

      const identical = diffPixels === 0;
      const diffPercent =
        totalPixels > 0
          ? parseFloat(((diffPixels / totalPixels) * 100).toFixed(4))
          : 0;

      if (outputPath && !identical) {
        writeFileSync(outputPath, PNG.sync.write(diffImage));
      }

      result = {
        identical,
        method: "pixelmatch",
        diffPixels,
        totalPixels,
        diffPercent,
        threshold,
        dimensions: { width, height },
      };
    }
  } catch {
    // Fallback to byte-level comparison
    const bufA = readFileSync(baselinePath);
    const bufB = readFileSync(currentPath);

    const identical = bufA.equals(bufB);
    const totalBytes = Math.max(bufA.length, bufB.length);
    let diffBytes = 0;

    if (!identical) {
      for (let i = 0; i < totalBytes; i++) {
        if ((bufA[i] || 0) !== (bufB[i] || 0)) {
          diffBytes++;
        }
      }
    }

    const diffPercent =
      totalBytes > 0
        ? parseFloat(((diffBytes / totalBytes) * 100).toFixed(4))
        : 0;

    result = {
      identical,
      method: "byte-comparison",
      note: "Install pixelmatch and pngjs for pixel-level comparison",
      totalBytes,
      diffBytes,
      diffPercent,
    };
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.identical ? 0 : 1);
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(2);
}
