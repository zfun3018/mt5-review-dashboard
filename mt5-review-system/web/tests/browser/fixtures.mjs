// Playwright fixture that boots the real Python HTTP server against a
// throw-away runtime root. Each test that imports `test` from this module
// gets its own isolated server backed by a unique `MT5_REVIEW_DATA_DIR`
// temp directory; teardown kills the child process and removes the dir.
//
// The fixture never touches the default project database. The default
// Python interpreter is the sandbox-managed 3.13.12; override with
// `MT5_TEST_PYTHON=/path/to/python.exe` if a different interpreter is
// required (e.g. one with a venv that mirrors the production environment).

import net from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";

const DEFAULT_PYTHON =
  "C:/Users/61753/.workbuddy/binaries/python/versions/3.13.12/python.exe";

const here = path.dirname(fileURLToPath(import.meta.url));
// web/tests/browser/fixtures.mjs is three levels below mt5-review-system.
const projectRoot = path.resolve(here, "..", "..", "..");

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
      lastError = new Error(`status=${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Server at ${url} did not become healthy within ${timeoutMs}ms (${
      lastError ? lastError.message : "no response"
    })`,
  );
}

function startServer({ port, dataDir, pythonExe }) {
  const child = spawn(
    pythonExe,
    ["-X", "utf8", "-m", "app.server"],
    {
      cwd: path.join(projectRoot, "server"),
      env: {
        ...process.env,
        MT5_REVIEW_HOST: "127.0.0.1",
        MT5_REVIEW_PORT: String(port),
        MT5_REVIEW_DATA_DIR: dataDir,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  return { child, getStdout: () => stdout.join(""), getStderr: () => stderr.join("") };
}

async function seedPlaceholderScreenshots(dataDir) {
  // Write a minimal PNG signature so /api/review-album can serve at least one
  // entry. The server tolerates missing files but tests should observe a
  // populated album for the screenshot placeholder assertion.
  const screenshotsDir = path.join(dataDir, "screenshots");
  await fs.mkdir(screenshotsDir, { recursive: true });
  // 1x1 transparent PNG
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  await fs.writeFile(path.join(screenshotsDir, "seed.png"), pngBytes);
}

export const test = base.extend({
  syntheticServer: [
      async ({}, use, testInfo) => {
        const dataDir = await fs.mkdtemp(
          path.join(os.tmpdir(), `mt5-fixture-${testInfo.testId.replace(/[^A-Za-z0-9_-]/g, "_")}-`),
        );
        await seedPlaceholderScreenshots(dataDir);
        const port = await getFreePort();
        const pythonExe = process.env.MT5_TEST_PYTHON || DEFAULT_PYTHON;
        const { child, getStdout, getStderr } = startServer({
          port,
          dataDir,
          pythonExe,
        });
        const baseURL = `http://127.0.0.1:${port}`;
        const healthURL = `${baseURL}/api/health`;
        try {
          await waitForHealth(healthURL, 30_000);
        } catch (err) {
          child.kill("SIGTERM");
          throw new Error(
            `Server failed to become healthy: ${err.message}\n--- stdout ---\n${getStdout()}\n--- stderr ---\n${getStderr()}`,
          );
        }
        await use({ baseURL, dataDir });
        child.kill("SIGTERM");
        await new Promise((resolve) => {
          if (child.exitCode !== null) resolve(undefined);
          else child.once("exit", () => resolve(undefined));
          setTimeout(() => {
            if (child.exitCode === null) child.kill("SIGKILL");
            resolve(undefined);
          }, 5_000).unref();
        });
        await fs.rm(dataDir, { recursive: true, force: true });
      },
      { scope: "test" },
    ],
});

export { expect };