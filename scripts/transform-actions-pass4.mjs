/**
 * Pass 4: Fix the tenantId injection.
 * Pass 3 injected lines after the FIRST '{' in a function, but many functions
 * have '{' inside parameter type annotations (e.g. data: { name?: string }).
 * The true function body '{' only comes after all '(' are balanced.
 *
 * Strategy:
 * 1. Strip ALL existing `const tenantId = await getActiveTenantId();` lines
 * 2. Re-inject by tracking paren depth: only fire when parenDepth == 0 and we see '{'
 */
import { readFileSync, writeFileSync } from "fs";

const filePath =
  "c:\\Users\\User\\Desktop\\vs_copilot_Window Cleaning App\\src\\lib\\actions.ts";

let src = readFileSync(filePath, "utf8");

// Step 1: Remove all existing injected lines
const INJECT_LINE = "  const tenantId = await getActiveTenantId();";
const before = src.split("\n").length;
src = src
  .split("\n")
  .filter((l) => l !== INJECT_LINE)
  .join("\n");
const after = src.split("\n").length;
console.log(`Removed ${before - after} existing injection lines`);

// Step 2: Re-inject with correct paren+brace tracking
const lines = src.split("\n");
const out = [];

let inExportedFn = false; // scanning for the body open brace
let parenDepth = 0;
let braceDepth = 0;
let injected = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();

  if (inExportedFn) {
    // Count parens and braces character by character
    for (const ch of line) {
      if (ch === "(") parenDepth++;
      if (ch === ")") parenDepth--;
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }

    out.push(line);

    // The function body opens when parenDepth == 0 and braceDepth goes to 1
    if (parenDepth === 0 && braceDepth === 1) {
      // Make sure we're not already injecting
      const nextLine = lines[i + 1] || "";
      if (!nextLine.includes("getActiveTenantId")) {
        out.push(INJECT_LINE);
        injected++;
      }
      inExportedFn = false;
      parenDepth = 0;
      braceDepth = 0;
    }
  } else {
    out.push(line);

    if (/^export async function /.test(trimmed)) {
      inExportedFn = true;
      parenDepth = 0;
      braceDepth = 0;
      // Count braces/parens on this first line too
      for (const ch of line) {
        if (ch === "(") parenDepth++;
        if (ch === ")") parenDepth--;
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }
      // Check if body already opened on the same line
      if (parenDepth === 0 && braceDepth === 1) {
        const nextLine = lines[i + 1] || "";
        if (!nextLine.includes("getActiveTenantId")) {
          out.push(INJECT_LINE);
          injected++;
        }
        inExportedFn = false;
      }
    }
  }
}

console.log(`Injected tenantId into ${injected} exported functions`);
writeFileSync(filePath, out.join("\n"), "utf8");
console.log("✓ Pass 4 complete");
