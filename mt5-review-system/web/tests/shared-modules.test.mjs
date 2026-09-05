import assert from "node:assert/strict";
import test from "node:test";

import { HttpError, RequestGate, requestJson } from "../shared/js/api.mjs";
import {
  escapeHtml,
  formatBytes,
  formatHoldingTime,
  formatMoney,
  formatPercent,
  formatPrice,
  formatR,
  formatVolume,
  profitClass,
  signedR,
} from "../shared/js/formatters.mjs";

test("request gate aborts the older request in one region", () => {
  const gate = new RequestGate();
  const first = gate.begin("analysis");
  const second = gate.begin("analysis");
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
});

test("request gate isolates regions and aborts every request on unload", () => {
  const gate = new RequestGate();
  const analysis = gate.begin("analysis");
  const orders = gate.begin("orders");
  assert.equal(analysis.signal.aborted, false);
  assert.equal(orders.signal.aborted, false);

  gate.abortAll();
  assert.equal(analysis.signal.aborted, true);
  assert.equal(orders.signal.aborted, true);
});

test("request gate runs a factory and removes its controller on settle", async () => {
  const gate = new RequestGate();
  const seen = [];
  const result = await gate.run("orders", (signal) => {
    seen.push(signal.aborted);
    return Promise.resolve(42);
  });
  assert.equal(result, 42);
  assert.deepEqual(seen, [false]);
  assert.equal(gate.controllers.size, 0);
});

test("requestJson sets JSON headers only with a body and stringifies objects", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  try {
    await requestJson("/api/status");
    await requestJson("/api/analysis-settings", { method: "PATCH", body: { scratch_threshold_r: 0.2 } });

    assert.equal(calls[0].url, "/api/status");
    assert.equal(calls[0].options.headers, undefined);
    assert.equal(calls[1].options.headers["Content-Type"], "application/json");
    assert.equal(calls[1].options.body, JSON.stringify({ scratch_threshold_r: 0.2 }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestJson maps non-2xx responses to HttpError with the server message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 422,
    json: async () => ({ error: "阈值超出范围" }),
  });
  try {
    await assert.rejects(requestJson("/api/analysis-settings"), (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 422);
      assert.equal(error.message, "阈值超出范围");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestJson tolerates empty responses without throwing a parse error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 204, json: async () => { throw new Error("no body"); } });
  try {
    assert.equal(await requestJson("/api/backups"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("formatters preserve current money and R output", () => {
  assert.equal(formatMoney(12.5), "$12.50");
  assert.equal(formatR(1.256), "+1.26R");
  assert.equal(signedR(1.256), "+1.26R");
});

test("formatters render missing values as dashes", () => {
  assert.equal(formatMoney(null), "-");
  assert.equal(formatMoney(undefined), "-");
  assert.equal(formatPrice(null), "-");
  assert.equal(formatR(undefined), "-");
  assert.equal(formatVolume("n/a"), "-");
});

test("formatters format percentages, prices, volumes, durations, and bytes", () => {
  assert.equal(formatPercent(0.456), "46%");
  assert.equal(formatPrice(12.5), "12.5");
  assert.equal(formatVolume(1.5), "1.50");
  assert.equal(formatHoldingTime(90061), "1天1时");
  assert.equal(formatBytes(1536), "1.5 KB");
});

test("formatters escape HTML and classify profit direction", () => {
  assert.equal(escapeHtml("<script>&\"'"), "&lt;script&gt;&amp;&quot;&#039;");
  assert.equal(profitClass(-5), "loss-text");
  assert.equal(profitClass(5), "profit-text");
});
