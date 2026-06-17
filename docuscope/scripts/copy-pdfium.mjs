// Copies the PDFium WebAssembly binary out of the installed
// `@embedpdf/pdfium` package into `public/pdfium.wasm` so the file served at
// runtime (see app/PdfViewerModal.tsx -> wasmUrl: "/pdfium.wasm") ALWAYS
// matches the installed package version. This replaces a hand-committed blob,
// avoiding silent version skew after `npm update`.
//
// Cross-platform Node ESM script. Wired into package.json via postinstall,
// predev and prebuild so the file is present for dev, build, and tests/CI.

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Resolve the wasm through the package's export map so we always pick up the
// file shipped by the installed version. Falls back to the known dist path.
let source;
try {
  source = require.resolve("@embedpdf/pdfium/pdfium.wasm");
} catch {
  try {
    const pkgJson = require.resolve("@embedpdf/pdfium/package.json");
    source = resolve(dirname(pkgJson), "dist", "pdfium.wasm");
  } catch {
    source = undefined;
  }
}

if (!source) {
  console.error(
    "[copy-pdfium] Could not resolve @embedpdf/pdfium. Is it installed? " +
      "Run `npm install` and try again.",
  );
  process.exit(1);
}

const dest = resolve(projectRoot, "public", "pdfium.wasm");

try {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
} catch (err) {
  console.error(
    `[copy-pdfium] Failed to copy PDFium wasm from ${source} to ${dest}:`,
    err.message,
  );
  process.exit(1);
}

console.log(`[copy-pdfium] Copied ${source} -> ${dest}`);
