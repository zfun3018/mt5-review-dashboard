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

  assert.match(tokens, /--glass-base-fallback:\s*#1e2d39;/);
  assert.match(tokens, /--glass-clear-fallback:\s*#2c4351;/);
  assert.match(tokens, /--glass-fluid-fallback:\s*#354f60;/);
  assert.match(tokens, /--motion-duration-expand:\s*220ms;/);
  assert.match(tokens, /--motion-duration-collapse:\s*160ms;/);
  assert.match(tokens, /--motion-distance-float:\s*4px;/);
});

test("base styles provide reduced-motion fallbacks", async () => {
  const base = await readFile(join(cssDir, "base.css"), "utf8");
  assert.match(base, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(base, /\[data-fluid-motion\][\s\S]*?animation:\s*none\s*!important[\s\S]*?transform:\s*none\s*!important/);
  assert.match(base, /\.floating-context-card[\s\S]*?animation:\s*none\s*!important/);
  assert.match(base, /\.app-shell::before[\s\S]*?animation:\s*none\s*!important/);
  assert.match(base, /body::before[\s\S]*?animation:\s*none\s*!important/);
});

test("shared components expose glass, menu, tag, state, and motion primitives", async () => {
  const components = await readFile(join(cssDir, "components.css"), "utf8");
  const shell = await readFile(join(cssDir, "shell.css"), "utf8");
  for (const className of [
    ".glass-surface",
    ".glass-surface--clear",
    ".glass-surface--fluid",
    ".glow-pill",
    ".glass-menu",
    ".glass-menu__option",
    ".floating-context-card",
    ".region-state",
    ".modal-surface",
  ]) {
    assert.match(components, new RegExp(`${className.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?:\\s*,|\\s*\\{)`));
  }
  assert.match(components, /:focus-visible/);
  assert.match(components, /@supports\s+not\s*\(backdrop-filter:\s*blur\(1px\)\)/);
  assert.match(components, /--glass-(?:base|clear|fluid)-fallback/);
  assert.match(components, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(components, /@supports\s+not[\s\S]*\.glass-surface[\s\S]*var\(--glass-base-fallback\)/);
  assert.match(components, /\.glass-menu__option:focus-visible/);
  assert.match(components, /\.glass-menu__option(?:\[aria-disabled="true"\]|:disabled)/);
  assert.match(components, /\.glow-pill(?:\[data-selected="true"\]|\.is-selected)/);
  assert.match(components, /\.glow-pill(?:\[aria-disabled="true"\]|\.is-disabled|:disabled)/);
  assert.match(components, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.floating-context-card\s*\{\s*animation:\s*none/);
  assert.match(shell, /app-page-bar__actions/);
});

test("glass surfaces expose a visible moving refraction layer", async () => {
  const components = await readFile(join(cssDir, "components.css"), "utf8");
  assert.match(components, /\.glass-surface::after[\s\S]*?\.glass-menu::after/);
  assert.match(components, /background:\s*linear-gradient\(\s*105deg,[\s\S]*?rgba\(220, 247, 255, 0\.2\)/);
  assert.match(components, /animation:\s*glass-surface-sheen\s+var\(--motion-duration-sheen\)/);
  assert.match(components, /@keyframes\s+glass-surface-sheen[\s\S]*?transform:[\s\S]*?translate3d/);
  assert.match(components, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.glass-surface::after[\s\S]*?animation:\s*none/);
});
