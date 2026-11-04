import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const testDir = dirname(fileURLToPath(import.meta.url));
const cssDir = join(testDir, "..", "shared", "css");

test("shared Fluid Luminous tokens expose the visual contract", async () => {
  const tokens = await readFile(join(cssDir, "tokens.css"), "utf8");
  const requiredTokens = [
    "--glass-atmosphere",
    "--glass-base",
    "--glass-clear",
    "--glass-fluid",
    "--glass-blur",
    "--glass-saturation",
    "--motion-duration-expand",
    "--motion-duration-collapse",
    "--motion-distance-float",
    "--focus-ring-color",
    "--color-tag-scene",
    "--color-tag-strategy",
    "--color-tag-mistake",
    "--color-tag-success",
    "--color-tag-warning",
  ];

  for (const token of requiredTokens) {
    assert.match(tokens, new RegExp(`${token.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*:\\s*[^;]+;`), `missing concrete token ${token}`);
  }
});

test("base styles provide reduced-motion fallbacks", async () => {
  const base = await readFile(join(cssDir, "base.css"), "utf8");
  assert.match(base, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});
