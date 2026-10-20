import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const moduleUrl = (file) => pathToFileURL(path.resolve(import.meta.dirname, "..", file)).href;

test("platform state normalizes URL and builds a switchable workspace URL", async () => {
  const platform = await import(`${moduleUrl("shared/js/platform.mjs")}?platform-test`);

  assert.equal(platform.normalizePlatform("tonghuashun"), "domestic_futures");
  assert.equal(platform.readPlatform({ search: "?platform=tonghuashun_futures" }), "domestic_futures");
  assert.equal(platform.withPlatform("/orders/?page=2", "domestic_futures"), "/orders/?page=2&platform=domestic_futures");
});

test("platform options expose direct MT5 and domestic futures workspaces", async () => {
  const { PLATFORM_OPTIONS } = await import(`${moduleUrl("shared/js/platform.mjs")}?options-test`);
  assert.deepEqual(PLATFORM_OPTIONS, [
    { id: "mt5", label: "MT5" },
    { id: "domestic_futures", label: "国内期货" },
  ]);
});
