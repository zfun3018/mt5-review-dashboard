const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {pathToFileURL} = require("node:url");

const webRoot = path.resolve(__dirname, "..");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.filter(Boolean).forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) this.add(name);
    else this.remove(name);
    return enabled;
  }

  toString() {
    return [...this.values].join(" ");
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.textContent = "";
    this.disabled = false;
    this.tabIndex = -1;
    this.hiddenFromLayout = false;
  }

  set className(value) {
    this.classList = new FakeClassList();
    String(value).split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name));
  }

  get className() {
    return this.classList.toString();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  append(...children) {
    children.forEach((child) => {
      child.parentElement = this;
      this.children.push(child);
    });
  }

  appendChild(child) {
    this.append(child);
    return child;
  }

  replaceChildren(...children) {
    this.children.forEach((child) => {
      child.parentElement = null;
    });
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    event.preventDefault ||= () => {
      event.defaultPrevented = true;
    };
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return !event.defaultPrevented;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  getClientRects() {
    return this.hiddenFromLayout ? [] : [{}];
  }

  querySelectorAll(selector) {
    const descendants = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        descendants.push(child);
        visit(child);
      });
    };
    visit(this);
    if (selector.includes("a[href]") && selector.includes("button:not([disabled])")) {
      return descendants.filter((node) => (
        (node.tagName === "A" && node.hasAttribute("href"))
        || (node.tagName === "BUTTON" && !node.disabled)
        || node.tabIndex >= 0
      ));
    }
    if (selector === "a") return descendants.filter((node) => node.tagName === "A");
    if (selector.startsWith("[aria-label=")) {
      const label = selector.slice(13, -2);
      return descendants.filter((node) => node.getAttribute("aria-label") === label);
    }
    return [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.body = new FakeElement("body", this);
    this.activeElement = this.body;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  querySelector(selector) {
    if (selector === "[data-app-shell]") {
      return this.body.children.find((node) => node.hasAttribute("data-app-shell")) || null;
    }
    return this.body.querySelector(selector);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, values = {}) {
    const event = {
      type,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...values,
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

function moduleUrl(relativePath) {
  return pathToFileURL(path.join(webRoot, relativePath)).href;
}

test("shell defines the four workspace destinations", async () => {
  const {NAV_ITEMS} = await import(moduleUrl("shared/js/shell.mjs"));

  assert.deepEqual(
    NAV_ITEMS.map(({href, label}) => ({href, label})),
    [
      {href: "/dashboard/", label: "复盘仪表盘"},
      {href: "/orders/", label: "订单列表"},
      {href: "/album/", label: "复盘图册"},
      {href: "/settings/", label: "设置"},
    ],
  );
});

test("shell manages active navigation, drawer focus, escape, collapse, and cleanup", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const document = new FakeDocument();
  const root = document.createElement("div");
  root.setAttribute("data-app-shell", "");
  document.body.append(root);
  let iconRefreshes = 0;
  globalThis.document = document;
  globalThis.window = {
    lucide: {createIcons: () => { iconRefreshes += 1; }},
    matchMedia: () => ({matches: true, addEventListener() {}, removeEventListener() {}}),
  };

  try {
    const shell = await import(`${moduleUrl("shared/js/shell.mjs")}?shell-test`);
    const action = document.createElement("button");
    action.textContent = "刷新";
    const cleanup = shell.mountShell({
      activeRoute: "/orders/",
      title: "订单列表",
      actions: [action],
    });
    const links = root.querySelectorAll("a");
    const navigation = root.children.find((node) => node.tagName === "ASIDE");
    const menuButton = root.querySelector('[aria-label="打开导航"]');
    const collapseButton = root.querySelector('[aria-label="折叠导航"]');

    assert.equal(typeof cleanup, "function");
    assert.equal(links.find((link) => link.getAttribute("href") === "/orders/").getAttribute("aria-current"), "page");
    assert.equal(root.querySelectorAll('[aria-label="订单列表"]')[0].textContent, "订单列表");
    assert.equal(menuButton.getAttribute("title"), "打开导航");
    assert.equal(iconRefreshes, 1);

    collapseButton.dispatchEvent({type: "click"});
    assert.equal(root.getAttribute("data-navigation-collapsed"), "true");

    menuButton.focus();
    menuButton.dispatchEvent({type: "click"});
    const focusable = navigation.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    assert.equal(navigation.getAttribute("aria-hidden"), "false");
    assert.equal(document.body.classList.contains("navigation-open"), true);
    assert.equal(document.activeElement, focusable[0]);

    focusable.at(-1).focus();
    const tab = document.dispatch("keydown", {key: "Tab", shiftKey: false});
    assert.equal(tab.defaultPrevented, true);
    assert.equal(document.activeElement, focusable[0]);

    collapseButton.hiddenFromLayout = true;
    const refreshButton = navigation.querySelector('[aria-label="刷新数据"]');
    refreshButton.focus();
    const mobileTab = document.dispatch("keydown", {key: "Tab", shiftKey: false});
    assert.equal(mobileTab.defaultPrevented, true);
    assert.equal(document.activeElement, links[0]);

    document.dispatch("keydown", {key: "Escape"});
    assert.equal(navigation.getAttribute("aria-hidden"), "true");
    assert.equal(document.body.classList.contains("navigation-open"), false);
    assert.equal(document.activeElement, menuButton);

    cleanup();
    assert.equal(root.children.length, 0);
    assert.equal(document.listeners.get("keydown").size, 0);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("shell keeps mobile drawer keyboard and ARIA state synchronized across viewport changes", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const document = new FakeDocument();
  const root = document.createElement("div");
  root.setAttribute("data-app-shell", "");
  document.body.append(root);
  let viewportListener = null;
  const mediaQuery = {
    matches: true,
    addEventListener: (type, listener) => {
      if (type === "change") viewportListener = listener;
    },
    removeEventListener: (type, listener) => {
      if (type === "change" && viewportListener === listener) viewportListener = null;
    },
  };
  globalThis.document = document;
  globalThis.window = {
    lucide: {createIcons: () => {}},
    matchMedia: () => mediaQuery,
  };

  try {
    const {mountShell} = await import(`${moduleUrl("shared/js/shell.mjs")}?viewport-test`);
    const cleanup = mountShell({title: "复盘仪表盘"});
    const navigation = root.children.find((node) => node.tagName === "ASIDE");
    const backdrop = root.querySelector('[aria-label="关闭导航"]');
    const menuButton = root.querySelector('[aria-label="打开导航"]');

    assert.equal(navigation.getAttribute("aria-hidden"), "true");
    assert.equal(navigation.hasAttribute("inert"), true);

    menuButton.dispatchEvent({type: "click"});
    assert.equal(navigation.getAttribute("aria-hidden"), "false");
    assert.equal(navigation.hasAttribute("inert"), false);

    mediaQuery.matches = false;
    viewportListener({matches: false});
    assert.equal(root.getAttribute("data-navigation-open"), "false");
    assert.equal(navigation.getAttribute("aria-hidden"), "false");
    assert.equal(navigation.hasAttribute("inert"), false);
    assert.equal(backdrop.getAttribute("aria-hidden"), "true");
    assert.equal(menuButton.getAttribute("aria-expanded"), "false");

    mediaQuery.matches = true;
    viewportListener({matches: true});
    assert.equal(navigation.getAttribute("aria-hidden"), "true");
    assert.equal(navigation.hasAttribute("inert"), true);

    cleanup();
    assert.equal(viewportListener, null);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("URL helpers coerce schema values and replace only meaningful query values", async () => {
  const {readQuery, replaceQuery} = await import(moduleUrl("shared/js/url-state.mjs"));
  const values = readQuery(
    {
      q: {type: "string", default: ""},
      page: {type: "integer", min: 1, default: 1},
      missing: {name: "r_missing", type: "boolean", default: false},
      mode: {type: "string", values: ["all", "long"], default: "all"},
      tags: {type: "array", default: []},
    },
    "?q=XAU&page=2&r_missing=1&mode=invalid&tags=a&tags=b",
  );
  const calls = [];
  const location = {pathname: "/orders/", search: "?old=1", hash: "#detail"};
  const history = {replaceState: (...args) => calls.push(args)};

  replaceQuery(
    {q: "XAU", page: 2, r_missing: true, empty: "", removed: null, tags: ["a", "b"]},
    {location, history},
  );

  assert.deepEqual(values, {q: "XAU", page: 2, missing: true, mode: "all", tags: ["a", "b"]});
  assert.deepEqual(calls, [[null, "", "/orders/?q=XAU&page=2&r_missing=1&tags=a&tags=b#detail"]]);

  const strictSchema = {
    page: {type: "integer", default: 7},
    enabled: {type: "boolean", default: true},
  };
  assert.deepEqual(readQuery(strictSchema, "?page=2x&enabled=maybe"), {page: 7, enabled: true});
  assert.deepEqual(readQuery(strictSchema, "?page=2&enabled=0"), {page: 2, enabled: false});
  const roundTripCalls = [];
  replaceQuery(
    {page: 7, enabled: false},
    {location, history: {replaceState: (...args) => roundTripCalls.push(args)}},
    strictSchema,
  );
  assert.deepEqual(roundTripCalls, [[null, "", "/orders/?page=7&enabled=0#detail"]]);
});

test("feedback helpers render accessible loading, error retry, and toast states", async () => {
  const originalDocument = globalThis.document;
  const document = new FakeDocument();
  globalThis.document = document;
  try {
    const {renderRegionState, showToast} = await import(`${moduleUrl("shared/js/feedback.mjs")}?feedback-test`);
    const region = document.createElement("section");
    let retries = 0;

    renderRegionState(region, {state: "loading", message: "正在读取"});
    assert.equal(region.children[0].getAttribute("role"), "status");
    assert.equal(region.children[0].children[0].textContent, "正在读取");

    renderRegionState(region, {state: "error", message: "读取失败", onRetry: () => { retries += 1; }});
    const retryButton = region.children[0].children[1];
    assert.equal(region.children[0].getAttribute("role"), "alert");
    retryButton.dispatchEvent({type: "click"});
    assert.equal(retries, 1);

    const disposeToast = showToast("保存成功", {tone: "success", duration: 0});
    const toast = document.body.children.at(-1);
    assert.equal(toast.getAttribute("role"), "status");
    assert.equal(toast.getAttribute("aria-live"), "polite");
    assert.equal(toast.classList.contains("feedback-toast--success"), true);
    disposeToast();
    assert.equal(document.body.children.includes(toast), false);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("shared styles enforce stable navigation, mobile targets, and visible focus", () => {
  const tokens = fs.readFileSync(path.join(webRoot, "shared/css/tokens.css"), "utf8");
  const base = fs.readFileSync(path.join(webRoot, "shared/css/base.css"), "utf8");
  const shell = fs.readFileSync(path.join(webRoot, "shared/css/shell.css"), "utf8");
  const components = fs.readFileSync(path.join(webRoot, "shared/css/components.css"), "utf8");
  const allStyles = [tokens, base, shell, components].join("\n");

  assert.match(tokens, /--sidebar-width:\s*224px/);
  assert.match(tokens, /--sidebar-collapsed-width:\s*64px/);
  assert.match(tokens, /--font-size-xs:\s*12px/);
  assert.match(tokens, /--font-size-display:\s*28px/);
  assert.match(shell, /grid-template-columns:\s*var\(--sidebar-width\)\s+minmax\(0,\s*1fr\)/);
  assert.match(shell, /@media\s*\(max-width:\s*720px\)/);
  assert.match(shell, /min-height:\s*44px/);
  const backdropRule = shell.match(/\.app-icon-button\.app-navigation__backdrop\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(backdropRule, /display:\s*none/);
  assert.match(backdropRule, /width:\s*auto/);
  assert.match(backdropRule, /background:\s*var\(--color-overlay\)/);
  assert.match(shell, /\.app-icon-button\.app-page-bar__menu\s*\{[^}]*display:\s*none/);
  assert.match(
    shell,
    /@media\s*\(max-width:\s*720px\)[\s\S]*\.app-icon-button\.app-navigation__collapse\s*\{[^}]*display:\s*none/,
  );
  assert.match(
    shell,
    /@media\s*\(max-width:\s*720px\)[\s\S]*\.app-icon-button\.app-page-bar__menu\s*\{[^}]*display:\s*inline-flex/,
  );
  assert.match(
    shell,
    /@media\s*\(max-width:\s*720px\)[\s\S]*\.app-shell\[data-navigation-collapsed="true"\] \.app-navigation__label[^{]*\{[^}]*display:\s*block/,
  );
  assert.match(base, /:focus-visible[\s\S]*outline:\s*2px solid var\(--color-accent\)/);
  assert.doesNotMatch(allStyles, /font-size:\s*clamp\(/);
  assert.doesNotMatch(allStyles, /linear-gradient|radial-gradient/);
  assert.match(components, /\.filter-bar\s*\{/);
  assert.match(components, /\.filter-bar__group\s*\{/);
  assert.match(components, /\.modal-backdrop\s*\{/);
  assert.match(components, /\.modal-surface\s*\{/);
  assert.match(components, /\.popover(?:\s*,|\s*\{)/);
  assert.match(components, /\.menu(?:\s*,|\s*\{)/);
  assert.match(components, /:disabled|\[aria-disabled="true"\]/);
  assert.match(components, /@media\s*\(max-width:\s*720px\)[\s\S]*\.filter-bar/);
});

test("shell omits unsupported runtime safety claims and keeps desktop navigation controls inert", async () => {
  const shellSource = fs.readFileSync(path.join(webRoot, "shared/js/shell.mjs"), "utf8");
  assert.doesNotMatch(shellSource, /仅限本机/);

  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const document = new FakeDocument();
  const root = document.createElement("div");
  root.setAttribute("data-app-shell", "");
  document.body.append(root);
  globalThis.document = document;
  globalThis.window = {
    lucide: {createIcons() {}},
    matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}}),
  };
  try {
    const {mountShell, openNavigation, closeNavigation} = await import(`${moduleUrl("shared/js/shell.mjs")}?desktop-guard-test`);
    const cleanup = mountShell({title: "复盘仪表盘"});
    const navigation = root.children.find((node) => node.tagName === "ASIDE");
    const menuButton = root.querySelector('[aria-label="打开导航"]');
    openNavigation();
    closeNavigation();
    assert.equal(root.getAttribute("data-navigation-open"), "false");
    assert.equal(navigation.getAttribute("aria-hidden"), "false");
    assert.equal(navigation.hasAttribute("inert"), false);
    assert.equal(document.body.classList.contains("navigation-open"), false);
    assert.equal(menuButton.getAttribute("aria-expanded"), "false");
    cleanup();
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("Lucide is pinned locally with its upstream license", () => {
  const lucide = fs.readFileSync(path.join(webRoot, "vendor/lucide.min.js"), "utf8");
  const license = fs.readFileSync(path.join(webRoot, "vendor/LICENSE-lucide.txt"), "utf8");

  assert.match(lucide.slice(0, 200), /@license lucide v1\.8\.0 - ISC/);
  assert.match(license, /ISC License/);
  assert.match(license, /Copyright \(c\) 2026 Lucide Icons and Contributors/);
});
