import assert from "node:assert/strict";
import test from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";
import path from "node:path";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = (relativePath) => pathToFileURL(path.join(webRoot, relativePath)).href;

test("module registry rejects duplicate types and exposes immutable definitions", async () => {
  const {createModuleRegistry} = await import(moduleUrl("b0-lab/module-registry.mjs"));
  const registry = createModuleRegistry();
  registry.register({type: "equity", title: "累计净值", defaultSize: {w: 8, h: 5}});

  assert.equal(registry.get("equity").title, "累计净值");
  assert.throws(
    () => registry.register({type: "equity", title: "重复", defaultSize: {w: 4, h: 4}}),
    /already registered/,
  );
  assert.throws(() => { registry.get("equity").title = "被修改"; }, TypeError);
});

test("workspace creates unique instances and duplicates settings without sharing identity", async () => {
  const {createWorkspace} = await import(moduleUrl("b0-lab/dashboard-core.mjs"));
  const definitions = new Map([
    ["equity", {type: "equity", title: "累计净值", defaultSize: {w: 8, h: 5}}],
  ]);
  let nextId = 0;
  const workspace = createWorkspace({
    definitions,
    idFactory: () => `module-${++nextId}`,
  });

  const first = workspace.add("equity", {settings: {range: "90d"}});
  const duplicate = workspace.duplicate(first.id);

  assert.equal(first.id, "module-1");
  assert.equal(duplicate.id, "module-2");
  assert.equal(duplicate.type, first.type);
  assert.deepEqual(duplicate.settings, first.settings);
  assert.notEqual(duplicate.settings, first.settings);
  assert.equal(workspace.snapshot().instances.length, 2);
});

test("removing and hiding target only affect that module instance", async () => {
  const {createWorkspace} = await import(moduleUrl("b0-lab/dashboard-core.mjs"));
  const definitions = new Map([
    ["equity", {type: "equity", title: "累计净值", defaultSize: {w: 8, h: 5}}],
  ]);
  let nextId = 0;
  const workspace = createWorkspace({definitions, idFactory: () => `module-${++nextId}`});
  const first = workspace.add("equity");
  const second = workspace.add("equity");

  workspace.setVisibility(first.id, false);
  assert.equal(workspace.get(first.id).visible, false);
  assert.equal(workspace.get(second.id).visible, true);

  assert.equal(workspace.remove(first.id), true);
  assert.equal(workspace.get(first.id), null);
  assert.equal(workspace.get(second.id).id, second.id);
});

test("stored layout is normalized and malformed JSON falls back safely", async () => {
  const {loadWorkspace, saveWorkspace} = await import(moduleUrl("b0-lab/dashboard-core.mjs"));
  const definitions = new Map([
    ["equity", {type: "equity", title: "累计净值", defaultSize: {w: 8, h: 5}}],
  ]);
  const fallback = {version: 1, instances: [{id: "fallback", type: "equity", visible: true, x: 0, y: 0, w: 8, h: 5, settings: {}}]};
  const storage = new Map();
  const adapter = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
  };

  adapter.setItem("layout", "not-json");
  assert.deepEqual(loadWorkspace(adapter, "layout", fallback, definitions), fallback);

  adapter.setItem("layout", JSON.stringify({version: 1, instances: [
    {id: "valid", type: "equity", x: -4, y: 2, w: 99, h: 0, settings: {range: "30d"}},
    {id: "unknown", type: "missing"},
  ]}));
  const restored = loadWorkspace(adapter, "layout", fallback, definitions);
  assert.equal(restored.instances.length, 2);
  assert.deepEqual(restored.instances[0], {
    id: "valid", type: "equity", visible: true, x: 0, y: 2, w: 12, h: 1, settings: {range: "30d"},
  });
  assert.equal(restored.instances[1].status, "unavailable");

  saveWorkspace(adapter, "saved", restored);
  assert.deepEqual(JSON.parse(adapter.getItem("saved")), restored);
});

test("workspace reports unknown module types explicitly", async () => {
  const {createWorkspace} = await import(moduleUrl("b0-lab/dashboard-core.mjs"));
  const workspace = createWorkspace({definitions: new Map()});
  assert.throws(() => workspace.add("missing"), /Unknown module type: missing/);
});
