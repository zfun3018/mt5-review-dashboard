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
    "--glass-nested",
    "--glass-nested-fluid",
    "--glass-spectrum-edge",
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

test("glass surfaces expose a visible static diagonal refraction layer", async () => {
  const components = await readFile(join(cssDir, "components.css"), "utf8");
  assert.match(components, /\.glass-surface::after[\s\S]*?\.glass-menu::after/);
  assert.match(components, /background:\s*linear-gradient\(\s*135deg,[\s\S]*?rgba\(220, 247, 255, 0\.07\)/);
  assert.match(components, /mix-blend-mode:\s*screen/);
  assert.match(components, /background:\s*var\(--glass-spectrum-edge\)/);
  assert.match(components, /mask-composite:\s*exclude/);
  assert.match(components, /animation:\s*none/);
  assert.doesNotMatch(components, /glass-surface-sheen/);
  assert.doesNotMatch(components, /will-change:\s*transform/);
});

test("shared surface language separates sibling cards from raised controls and overlays", async () => {
  const tokens = await readFile(join(cssDir, "tokens.css"), "utf8");
  const components = await readFile(join(cssDir, "components.css"), "utf8");
  const surfaceLanguage = await readFile(join(cssDir, "surface-language.css"), "utf8");

  for (const token of [
    "--glass-card-fill",
    "--glass-card-rim",
    "--glass-card-shadow",
    "--glass-refraction-fill",
    "--glass-refraction-rim",
    "--glass-refraction-edge",
    "--glass-refraction-card-shadow",
    "--glass-refraction-blur",
    "--glass-refraction-radius",
    "--glass-refraction-selected-fill",
    "--glass-refraction-selected-rim",
    "--glass-refraction-selected-glow",
    "--glass-refraction-selected-bevel",
    "--glass-refraction-selected-blur",
    "--glass-refraction-text-glow",
    "--glass-control-fill",
    "--glass-control-rim",
    "--glass-control-shadow",
    "--glass-overlay-shadow",
    "--glass-level-card",
    "--glass-level-control",
    "--glass-level-overlay",
  ]) {
    assert.match(tokens, new RegExp(`${token.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*:\\s*[^;]+;`), `missing shared layer token ${token}`);
  }

  for (const className of [
    ".glass-card",
    ".glass-control",
    ".glass-control--selected",
    ".glass-overlay",
  ]) {
    assert.match(components, new RegExp(`${className.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\{`));
  }

  assert.match(components, /\.glass-card\s*\{[\s\S]*?z-index:\s*var\(--glass-level-card\)/);
  assert.match(components, /\.glass-control\s*\{[\s\S]*?z-index:\s*var\(--glass-level-control\)/);
  assert.match(components, /\.glass-overlay\s*\{[\s\S]*?z-index:\s*var\(--glass-level-overlay\)/);
  assert.match(surfaceLanguage, /\.glass-surface[^\{]*:hover[\s\S]*?transform:\s*none/);
  assert.match(surfaceLanguage, /\.orders-index-column[\s\S]*var\(--glass-refraction-fill\)/);
  assert.match(surfaceLanguage, /\.orders-index-column[\s\S]*var\(--glass-refraction-selected-fill\)/);
});
