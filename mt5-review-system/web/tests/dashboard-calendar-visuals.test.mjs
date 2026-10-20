import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("calendar renders semantic bright tone classes instead of inline translucent backgrounds", () => {
  const dashboard = fs.readFileSync(path.join(webRoot, "dashboard/dashboard.mjs"), "utf8");
  const styles = fs.readFileSync(path.join(webRoot, "dashboard/dashboard.css"), "utf8");

  assert.doesNotMatch(dashboard, /style="background:\$\{calendarColor/);
  assert.match(dashboard, /class="day-cell \$\{tone\}/);
  assert.match(styles, /\.day-cell\.profit-day/);
  assert.match(styles, /\.day-cell\.loss-day/);
  assert.match(styles, /background:\s*#(?:[0-9a-fA-F]{6})/);
});
