import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("A1 visual demo is isolated from A page assets and business data", async () => {
  const html = await readFile(path.join(webRoot, "a1-visual-demo", "index.html"), "utf8");
  const css = await readFile(path.join(webRoot, "a1-visual-demo", "visual-demo.css"), "utf8");

  assert.match(html, /合成演示/);
  assert.match(html, /不连接业务数据/);
  assert.match(html, /\.\/visual-demo\.css/);
  assert.doesNotMatch(html, /shared\/css|dashboard\.css|orders\.css|fetch\(/);
  assert.match(css, /--radius-window:\s*28px/);
  assert.match(css, /--radius-panel:\s*24px/);
  assert.match(css, /--radius-inner:\s*18px/);
  assert.match(css, /--radius-pill:\s*999px/);
  assert.match(css, /--radius-circle:\s*50%/);
  assert.match(css, /--control-size:\s*42px/);
  assert.match(css, /--glass-fill:\s*rgba\(18, 22, 29, 0\.58\)/);
  assert.match(css, /--shadow-window:/);
  assert.match(css, /--shadow-panel:/);
  assert.match(css, /--shadow-float:/);
  assert.match(css, /backdrop-filter:\s*blur\(32px\)/);
});
