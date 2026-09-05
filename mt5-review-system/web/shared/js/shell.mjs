import { showToast } from "./feedback.mjs";

// Icons are rendered by the locally vendored Lucide v1.8.0 UMD release.
export const NAV_ITEMS = Object.freeze([
  {href: "/dashboard/", label: "复盘仪表盘", icon: "chart-no-axes-combined"},
  {href: "/orders/", label: "订单列表", icon: "list-checks"},
  {href: "/album/", label: "复盘图册", icon: "images"},
  {href: "/settings/", label: "设置", icon: "settings"},
]);

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
let mountedShell = null;
const NAV_COLLAPSED_STORAGE_KEY = "mt5-review-navigation-collapsed";

function readCollapsedPreference() {
  try {
    return globalThis.localStorage?.getItem(NAV_COLLAPSED_STORAGE_KEY) === "true";
  } catch (_error) {
    return false;
  }
}

function writeCollapsedPreference(collapsed) {
  try {
    globalThis.localStorage?.setItem(NAV_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch (_error) {
    // Private browsing or restricted storage should not block navigation.
  }
}

function createElement(tagName, {className, text, attributes} = {}) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attributes || {})) {
    node.setAttribute(name, value);
  }
  return node;
}

function icon(name) {
  return createElement("i", {
    attributes: {"data-lucide": name, "aria-hidden": "true"},
  });
}

function iconButton({label, iconName, className = ""}) {
  const button = createElement("button", {
    className: `app-icon-button ${className}`.trim(),
    attributes: {type: "button", title: label, "aria-label": label},
  });
  button.append(icon(iconName));
  return button;
}

function normalizedRoute(route) {
  const value = String(route || "/dashboard/").split(/[?#]/, 1)[0];
  return value.endsWith("/") ? value : `${value}/`;
}

function renderIcons() {
  const lucide = globalThis.window?.lucide || globalThis.lucide;
  if (lucide?.createIcons) {
    lucide.createIcons({attrs: {"stroke-width": 1.8}});
  }
}

function isMobileViewport() {
  return Boolean(globalThis.window?.matchMedia?.("(max-width: 720px)").matches);
}

function focusableElements(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter((element) => (
    typeof element.getClientRects !== "function" || element.getClientRects().length > 0
  ));
}

function setNavigationHidden(navigation, hidden) {
  navigation.setAttribute("aria-hidden", String(hidden));
  if (hidden) navigation.setAttribute("inert", "");
  else navigation.removeAttribute("inert");
}

function appendActions(container, actions) {
  if (!actions) return;
  if (typeof actions === "string") {
    container.insertAdjacentHTML?.("beforeend", actions);
    return;
  }
  const items = typeof actions[Symbol.iterator] === "function" ? actions : [actions];
  for (const action of items) {
    if (action) container.append(action);
  }
}

function setCollapsed(collapsed) {
  if (!mountedShell) return;
  const {root, collapseButton} = mountedShell;
  root.setAttribute("data-navigation-collapsed", String(collapsed));
  const label = collapsed ? "展开导航" : "折叠导航";
  collapseButton.setAttribute("title", label);
  collapseButton.setAttribute("aria-label", label);
  collapseButton.setAttribute("aria-expanded", String(!collapsed));
  collapseButton.replaceChildren(icon(collapsed ? "panel-left-open" : "panel-left-close"));
  renderIcons();
}

export function openNavigation() {
  if (!mountedShell) return;
  const {root, navigation, menuButton, backdrop} = mountedShell;
  if (!isMobileViewport()) {
    root.setAttribute("data-navigation-open", "false");
    setNavigationHidden(navigation, false);
    backdrop.setAttribute("aria-hidden", "true");
    menuButton.setAttribute("aria-expanded", "false");
    document.body.classList.remove("navigation-open");
    return;
  }
  root.setAttribute("data-navigation-open", "true");
  setNavigationHidden(navigation, false);
  backdrop.setAttribute("aria-hidden", "false");
  menuButton.setAttribute("aria-expanded", "true");
  document.body.classList.add("navigation-open");
  focusableElements(navigation)[0]?.focus();
}

export function closeNavigation({returnFocus = true} = {}) {
  if (!mountedShell) return;
  const {root, navigation, menuButton, backdrop} = mountedShell;
  root.setAttribute("data-navigation-open", "false");
  const mobile = isMobileViewport();
  setNavigationHidden(navigation, mobile);
  backdrop.setAttribute("aria-hidden", "true");
  menuButton.setAttribute("aria-expanded", "false");
  document.body.classList.remove("navigation-open");
  if (returnFocus && mobile) menuButton.focus();
}

function handleNavigationKeys(event) {
  if (!mountedShell || mountedShell.root.getAttribute("data-navigation-open") !== "true") {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeNavigation();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = focusableElements(mountedShell.navigation);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function mountShell({activeRoute = "/dashboard/", title = "", actions = [], onRefresh = null} = {}) {
  mountedShell?.cleanup();
  const root = document.querySelector("[data-app-shell]");
  if (!root) throw new Error("Missing [data-app-shell] mount point");
  const originalNodes = [...root.children];
  root.replaceChildren();
  root.classList.add("app-shell");
  const collapsedPreference = readCollapsedPreference();
  root.setAttribute("data-navigation-collapsed", String(collapsedPreference));
  root.setAttribute("data-navigation-open", "false");

  const mobileViewport = isMobileViewport();
  const navigation = createElement("aside", {
    className: "app-navigation",
    attributes: {
      id: "appNavigation",
      "aria-label": "应用导航",
      "aria-hidden": String(mobileViewport),
    },
  });
  if (mobileViewport) navigation.setAttribute("inert", "");
  const brand = createElement("div", {className: "app-navigation__brand"});
  const mark = createElement("span", {className: "app-navigation__mark", text: "MT"});
  const brandCopy = createElement("span", {className: "app-navigation__brand-copy"});
  brandCopy.append(
    createElement("strong", {text: "MT5 复盘"}),
    createElement("span", {text: "交易工作台"}),
  );
  brand.append(mark, brandCopy);

  const links = createElement("nav", {
    className: "app-navigation__links",
    attributes: {"aria-label": "工作区"},
  });
  const currentRoute = normalizedRoute(activeRoute);
  for (const item of NAV_ITEMS) {
    const link = createElement("a", {
      className: "app-navigation__link",
      attributes: {href: item.href, title: item.label},
    });
    if (normalizedRoute(item.href) === currentRoute) link.setAttribute("aria-current", "page");
    link.append(icon(item.icon), createElement("span", {className: "app-navigation__label", text: item.label}));
    links.append(link);
  }

  const footer = createElement("div", {className: "app-navigation__footer"});
  const refreshButton = createElement("button", {
    className: "app-navigation__refresh app-navigation__link",
    attributes: {type: "button", title: "刷新数据", "aria-label": "刷新数据"},
  });
  refreshButton.append(icon("refresh-cw"), createElement("span", {className: "app-navigation__label", text: "刷新数据"}));
  const environment = createElement("div", {className: "app-navigation__environment"});
  environment.append(createElement("span", {text: "v0.6.1"}));
  const collapseButton = iconButton({
    label: "折叠导航",
    iconName: "panel-left-close",
    className: "app-navigation__collapse",
  });
  collapseButton.setAttribute("aria-controls", "appNavigation");
  collapseButton.setAttribute("aria-expanded", "true");
  footer.append(refreshButton, environment, collapseButton);
  navigation.append(brand, links, footer);

  const backdrop = iconButton({
    label: "关闭导航",
    iconName: "x",
    className: "app-navigation__backdrop",
  });
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.setAttribute("tabindex", "-1");

  const main = createElement("div", {className: "app-shell__main"});
  const pageBar = createElement("header", {className: "app-page-bar"});
  const menuButton = iconButton({
    label: "打开导航",
    iconName: "menu",
    className: "app-page-bar__menu",
  });
  menuButton.setAttribute("aria-controls", "appNavigation");
  menuButton.setAttribute("aria-expanded", "false");
  const heading = createElement("h1", {
    text: title,
    attributes: {"aria-label": title},
  });
  const actionArea = createElement("div", {className: "app-page-bar__actions"});
  appendActions(actionArea, actions);
  pageBar.append(menuButton, heading, actionArea);
  const page = createElement("main", {className: "app-page", attributes: {id: "mainContent"}});
  page.append(...originalNodes);
  main.append(pageBar, page);
  root.append(navigation, backdrop, main);

  const onMenuClick = () => openNavigation();
  const onBackdropClick = () => closeNavigation();
  const onCollapseClick = () => {
    const collapsed = root.getAttribute("data-navigation-collapsed") !== "true";
    setCollapsed(collapsed);
    writeCollapsedPreference(collapsed);
  };
  const onRefreshClick = async () => {
    if (!onRefresh || refreshButton.disabled) return;
    refreshButton.disabled = true;
    refreshButton.setAttribute("aria-busy", "true");
    try {
      await onRefresh();
    } catch (error) {
      showToast(error?.message || "刷新数据失败", {tone: "error"});
    } finally {
      refreshButton.disabled = false;
      refreshButton.removeAttribute("aria-busy");
    }
  };
  const mediaQuery = globalThis.window?.matchMedia?.("(max-width: 720px)");
  const onViewportChange = (event) => {
    closeNavigation({returnFocus: false});
    if (!event.matches) setNavigationHidden(navigation, false);
  };
  menuButton.addEventListener("click", onMenuClick);
  backdrop.addEventListener("click", onBackdropClick);
  collapseButton.addEventListener("click", onCollapseClick);
  refreshButton.addEventListener("click", onRefreshClick);
  document.addEventListener("keydown", handleNavigationKeys);
  mediaQuery?.addEventListener?.("change", onViewportChange);

  const cleanup = () => {
    menuButton.removeEventListener("click", onMenuClick);
    backdrop.removeEventListener("click", onBackdropClick);
    collapseButton.removeEventListener("click", onCollapseClick);
    refreshButton.removeEventListener("click", onRefreshClick);
    document.removeEventListener("keydown", handleNavigationKeys);
    mediaQuery?.removeEventListener?.("change", onViewportChange);
    document.body.classList.remove("navigation-open");
    root.classList.remove("app-shell");
    root.removeAttribute("data-navigation-collapsed");
    root.removeAttribute("data-navigation-open");
    root.replaceChildren(...originalNodes);
    if (mountedShell?.root === root) mountedShell = null;
  };
  mountedShell = {root, navigation, menuButton, collapseButton, backdrop, refreshButton, cleanup};
  setCollapsed(collapsedPreference);
  return cleanup;
}
