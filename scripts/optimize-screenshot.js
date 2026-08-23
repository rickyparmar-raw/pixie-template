#!/usr/bin/env bun
// Optimizes screenshots for Pixie's visual guide system.
// Usage: bun scripts/optimize-screenshot.js <input-path> <output-relative-path>
// Example: bun scripts/optimize-screenshot.js ~/Desktop/shop.png shop-purchase/01.webp

const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error("Usage: bun scripts/optimize-screenshot.js <input-path> <output-relative-path>");
  console.error("Example: bun scripts/optimize-screenshot.js ~/Desktop/shop.png shop-purchase/01.webp");
  process.exit(1);
}

const inputPath = args[0];
const outputRelative = args[1];

// Resolve paths
const outputDir = path.join(__dirname, "..", "public", "screenshots");
const outputPath = path.join(outputDir, outputRelative);
const outputDirOnly = path.dirname(outputPath);

// Verify input exists
if (!fs.existsSync(inputPath)) {
  console.error(`Error: Input file not found: ${inputPath}`);
  process.exit(1);
}

// Create output directory if needed
if (!fs.existsSync(outputDirOnly)) {
  fs.mkdirSync(outputDirOnly, { recursive: true });
  console.log(`Created directory: ${outputDirOnly}`);
}

// Optimize and convert to WebP
sharp(inputPath)
  .resize(900, 900, {
    fit: "inside",
withoutEnlargement: true,
  })
  .webp({
    quality: 85,
    effort: 6,
  })
  .toFile(outputPath)
  .then((info) => {
    console.log(`✓ Optimized screenshot saved to: ${outputPath}`);
    console.log(`  Dimensions: ${info.width}x${info.height}`);
    console.log(`  Size: ${(info.size / 1024).toFixed(1)} KB`);
    console.log(`  URL path: /screenshots/${outputRelative}`);
  })
  .catch((err) => {
    console.error(`Error optimizing screenshot: ${err.message}`);
    process.exit(1);
  });
