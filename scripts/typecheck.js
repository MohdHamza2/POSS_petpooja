#!/usr/bin/env node
// Runs `tsc --noEmit` against every workspace's tsconfig.json.
// --rootDir is the repo root so cross-package imports (services importing
// siblings) typecheck without TS6059.
const { execFileSync } = require("child_process");
const { existsSync, readdirSync } = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const roots = ["apps", "packages", "services"];

let failed = false;

for (const root of roots) {
  const rootPath = path.join(repoRoot, root);
  if (!existsSync(rootPath)) continue;
  for (const dir of readdirSync(rootPath)) {
    const tsconfigPath = path.join(rootPath, dir, "tsconfig.json");
    if (!existsSync(tsconfigPath)) continue;
    console.log(`\n[typecheck] ${root}/${dir}`);
    try {
      execFileSync("npx", ["tsc", "--noEmit", "-p", tsconfigPath, "--rootDir", repoRoot], {
        stdio: "inherit",
        shell: true,
      });
    } catch {
      failed = true;
    }
  }
}

if (failed) {
  console.error("\n[typecheck] FAILED — one or more workspaces have type errors.");
  process.exit(1);
}
console.log("\n[typecheck] all workspaces clean.");
