// Cross-platform unit-test runner used by `npm run test:unit`. Recursively
// walks `web/tests/` for `*.test.js` and `*.test.mjs` files and feeds them
// to `node --test`. Replaces fragile shell-glob expansion that breaks when
// npm invokes scripts via cmd.exe on Windows.

import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const testsRoot = path.join(root, "web", "tests");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Browser specs use Playwright's runner, not `node --test`.
      if (entry === "browser") continue;
      out.push(...walk(full));
    } else if (/\.(test|test-|spec)\.(js|mjs)$/.test(entry) || /^test-/.test(entry)) {
      out.push(full);
    }
  }
  return out.sort();
}

const files = walk(testsRoot);
if (files.length === 0) {
  console.error(`No test files found under ${testsRoot}`);
  process.exit(2);
}

const child = spawn(
  process.execPath,
  ["--test", ...files],
  { stdio: "inherit" },
);
child.on("exit", (code, sig) => {
  if (sig) {
    process.kill(process.pid, sig);
    return;
  }
  process.exit(code ?? 1);
});