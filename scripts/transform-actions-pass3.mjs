import { readFileSync, writeFileSync } from "fs";

const filePath =
  "c:\\Users\\User\\Desktop\\vs_copilot_Window Cleaning App\\src\\lib\\actions.ts";

const src = readFileSync(filePath, "utf8");
const lines = src.split("\n");
const out = [];

const INJECT = "  const tenantId = await getActiveTenantId();";

let insideExportedFn = false; // true once we've seen "export async function"
let depth = 0;               // brace depth relative to function start
let injected = 0;
let waitingForOpenBrace = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();

  // Detect start of exported function declaration
  if (/^export async function /.test(trimmed)) {
    insideExportedFn = true;
    waitingForOpenBrace = true;
    depth = 0;
  }

  out.push(line);

  if (insideExportedFn && waitingForOpenBrace) {
    // Count braces on this line to detect when the function body opens
    for (const ch of line) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }
    // When depth reaches 1, the function body has just opened
    if (depth >= 1) {
      // Don't inject if already there
      const nextLine = lines[i + 1] || "";
      if (!nextLine.includes("getActiveTenantId")) {
        out.push(INJECT);
        injected++;
      }
      waitingForOpenBrace = false;
      insideExportedFn = false;
    }
  }
}

console.log(`Injected tenantId into ${injected} exported functions`);
writeFileSync(filePath, out.join("\n"), "utf8");
console.log("✓ Pass 3 complete");
