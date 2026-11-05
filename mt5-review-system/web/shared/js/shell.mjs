import { showToast } from "./feedback.mjs";
import { sharePageScreenshot } from "./share.mjs";
import { PLATFORM_OPTIONS, platformLabel, readPlatform, withPlatform, writePlatform } from "./platform.mjs";

// Icons are rendered by the locally vendored Lucide v1.8.0 UMD release.
export const NAV_ITEMS = Object.freeze([
  {href: "/dashboard/", label: "仪表盘", icon: "chart-no-axes-combined"},
  {href: "/orders/", label: "订单", icon: "list-checks"},
  {href: "/settings/", label: "设置", icon: "settings"},
]);

export { PLATFORM_OPTIONS };

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
let mountedShell = null;
const NAV_COLLAPSED_STORAGE_KEY = "mt5-review-navigation-collapsed";
const MOBILE_VIEWPORT_QUERY = "(max-width: 720px), (max-width: 900px) and (orientation: landscape) and (max-height: 600px)";

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

function platformButtonLabel(platform) {
  return `当前平台：${platformLabel(platform)}，点击切换`;
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
  return Boolean(globalThis.window?.matchMedia?.(MOBILE_VIEWPORT_QUERY).matches);
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

export function mountShell({activeRoute = "/dashboard/", title = "", actions = [], onRefresh = null, refreshLabel = null, refreshIcon = null, refreshErrorMessage = null, share = false, toolbarSearch = null, toolbarFilters = [], location = globalThis.location, navigate = (url) => { globalThis.location.href = url; }} = {}) {
  mountedShell?.cleanup();
  const root = document.querySelector("[data-app-shell]");
  if (!root) throw new Error("Missing [data-app-shell] mount point");
  const originalNodes = [...root.children];
  const filterNodes = (Array.isArray(toolbarFilters) ? toolbarFilters : [toolbarFilters]).filter(Boolean);
  const filterPlacements = filterNodes.map((node) => ({
    node,
    parent: node.parentElement,
    nextSibling: node.nextSibling,
    index: node.parentElement ? Array.from(node.parentElement.childNodes).indexOf(node) : -1,
  }));
  root.replaceChildren();
  root.classList.add("app-shell");
  let activePlatform = readPlatform(location);
  const previousPlatform = document.body?.getAttribute("data-platform");
  document.body?.setAttribute("data-platform", activePlatform);
  const isDomesticFutures = activePlatform === "domestic_futures";
  const workspaceMark = isDomesticFutures ? "期" : "MT";
  const actionLabel = refreshLabel || (activePlatform === "domestic_futures" ? "导入数据" : "刷新数据");
  const actionIcon = refreshIcon || (activePlatform === "domestic_futures" ? "upload" : "refresh-cw");
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
  const mark = createElement("span", {className: "app-navigation__mark", text: workspaceMark});
  const windowControls = createElement("div", {
    className: "app-navigation__window-controls",
    attributes: {"data-ui": "window-controls", "aria-hidden": "true"},
  });
  windowControls.append(
    createElement("span", {className: "app-navigation__window-dot app-navigation__window-dot--close"}),
    createElement("span", {className: "app-navigation__window-dot app-navigation__window-dot--minimize"}),
    createElement("span", {className: "app-navigation__window-dot app-navigation__window-dot--maximize"}),
  );
  brand.append(windowControls, mark);

  const links = createElement("nav", {
    className: "app-navigation__links",
    attributes: {"aria-label": "工作区"},
  });
  const currentRoute = normalizedRoute(activeRoute);
  for (const item of NAV_ITEMS) {
    const link = createElement("a", {
      className: "app-navigation__link",
      attributes: {
        href: activePlatform === "mt5" ? item.href : withPlatform(item.href, activePlatform),
        title: item.label,
      },
    });
    if (normalizedRoute(item.href) === currentRoute) link.setAttribute("aria-current", "page");
    link.append(icon(item.icon), createElement("span", {className: "app-navigation__label", text: item.label}));
    links.append(link);
  }

  const footer = createElement("div", {className: "app-navigation__footer"});
  const refreshButton = createElement("button", {
    className: "app-navigation__refresh app-navigation__link app-page-bar__refresh",
    attributes: {type: "button", title: actionLabel, "aria-label": actionLabel},
  });
  refreshButton.append(icon(actionIcon), createElement("span", {className: "app-navigation__label", text: actionLabel}));
  const environment = createElement("div", {className: "app-navigation__environment"});
  environment.append(createElement("span", {text: "v0.6.7"}));
  const collapseButton = iconButton({
    label: "折叠导航",
    iconName: "panel-left-close",
    className: "app-navigation__collapse",
  });
  collapseButton.setAttribute("aria-controls", "appNavigation");
  collapseButton.setAttribute("aria-expanded", "true");
  footer.append(environment, collapseButton);
  navigation.append(brand, links, footer);

  const backdrop = iconButton({
    label: "关闭导航",
    iconName: "x",
    className: "app-navigation__backdrop",
  });
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.setAttribute("tabindex", "-1");

  const main = createElement("div", {className: "app-shell__main"});
  const pageBar = createElement("header", {className: "app-page-bar", attributes: {"data-ui": "page-bar"}});
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
  const toolbarLeading = createElement("div", {className: "app-page-bar__leading"});
  toolbarLeading.append(menuButton);
  const toolbarTitle = createElement("div", {className: "app-page-bar__title"});
  toolbarTitle.append(heading);
  if (toolbarSearch) {
    const search = createElement("input", {
      className: "app-page-bar__search",
      attributes: {type: "search", placeholder: toolbarSearch.placeholder || "搜索订单", "aria-label": toolbarSearch.label || "搜索订单", "data-shell-search": "true"},
    });
    search.value = toolbarSearch.value || "";
    if (toolbarSearch.onInput) search.addEventListener("input", toolbarSearch.onInput);
    if (toolbarSearch.onSubmit) search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") toolbarSearch.onSubmit(search.value);
    });
    toolbarTitle.append(search);
  }
  let filters = null;
  if (filterNodes.length) {
    filters = createElement("div", {
      className: "app-page-bar__filters",
      attributes: {"aria-label": "页面筛选"},
    });
    filters.append(...filterNodes);
    const preset = filters.querySelector?.("#timePreset");
    const presetGroup = preset?.parentElement;
    const presetButtons = [];
    let syncPresetButtons = () => {};
    if (preset && presetGroup && preset.options?.length) {
      const segmented = createElement("div", {
        className: "app-filter-presets",
        attributes: {role: "tablist", "aria-label": preset.getAttribute("aria-label") || "时间范围"},
      });
      for (const option of preset.options) {
        const button = createElement("button", {
          className: "app-filter-preset",
          text: option.textContent,
          attributes: {type: "button", role: "tab", "aria-selected": "false", "data-preset": option.value},
        });
        const onPresetClick = () => {
          preset.value = option.value;
          const EventConstructor = preset.ownerDocument?.defaultView?.Event || globalThis.Event;
          if (EventConstructor) preset.dispatchEvent(new EventConstructor("change", {bubbles: true}));
          syncPresetButtons();
        };
        button.addEventListener("click", onPresetClick);
        presetButtons.push({button, value: option.value, onPresetClick});
        segmented.append(button);
      }
      presetGroup.insertBefore(segmented, preset);
      preset.classList.add("app-filter-native-select");
      preset.setAttribute("aria-hidden", "true");
      preset.tabIndex = -1;
      syncPresetButtons = () => presetButtons.forEach(({button, value}) => {
        const active = preset.value === value;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
      preset.addEventListener("change", syncPresetButtons);
      syncPresetButtons();
      globalThis.queueMicrotask?.(syncPresetButtons);
    }
    toolbarTitle.append(filters);
    filterNodes._cleanupPresetButtons = () => {
      if (!preset) return;
      preset.removeEventListener("change", syncPresetButtons);
      presetButtons.forEach(({button, onPresetClick}) => button.removeEventListener("click", onPresetClick));
    };
  }
  const actionArea = createElement("div", {className: "app-page-bar__actions", attributes: {"data-ui": "page-actions"}});
  appendActions(actionArea, actions);
  actionArea.append(refreshButton);
  const platformButton = iconButton({
    label: platformButtonLabel(activePlatform),
    iconName: "layers-3",
    className: "app-platform-button",
  });
  platformButton.setAttribute("data-share-exclude", "true");
  actionArea.append(platformButton);
  let shareButton = null;
  if (share) {
    shareButton = iconButton({label: "分享页面", iconName: "share-2", className: "app-share-button"});
    shareButton.setAttribute("data-share-exclude", "true");
    actionArea.append(shareButton);
  }
  pageBar.append(toolbarLeading, toolbarTitle, actionArea);
  const page = createElement("main", {className: "app-page", attributes: {id: "mainContent"}});
  page.append(...originalNodes.filter((node) => !filterNodes.includes(node)));
  main.append(pageBar, page);
  root.append(navigation, backdrop, main);

  const onMenuClick = () => openNavigation();
  const onBackdropClick = () => closeNavigation();
  const onCollapseClick = () => {
    const collapsed = root.getAttribute("data-navigation-collapsed") !== "true";
    setCollapsed(collapsed);
    writeCollapsedPreference(collapsed);
  };
  const onPlatformClick = () => {
    const nextIndex = (PLATFORM_OPTIONS.findIndex(({id}) => id === activePlatform) + 1) % PLATFORM_OPTIONS.length;
    activePlatform = writePlatform(PLATFORM_OPTIONS[nextIndex].id);
    navigate(withPlatform(`${location?.pathname || activeRoute}${location?.search || ""}`, activePlatform));
  };
  const onRefreshClick = async () => {
    if (!onRefresh || refreshButton.disabled) return;
    refreshButton.disabled = true;
    refreshButton.setAttribute("aria-busy", "true");
    try {
      await onRefresh();
    } catch (error) {
      showToast(error?.message || refreshErrorMessage || `${actionLabel}失败`, {tone: "error"});
    } finally {
      refreshButton.disabled = false;
      refreshButton.removeAttribute("aria-busy");
    }
  };
  const onShareClick = async () => {
    if (!shareButton || shareButton.disabled) return;
    shareButton.disabled = true;
    shareButton.setAttribute("aria-busy", "true");
    try {
      const result = await sharePageScreenshot();
      showToast(
        result.copied ? "截图已下载并复制到剪贴板" : "截图已下载，但未能复制到剪贴板",
        {tone: result.copied ? "success" : "info"},
      );
    } catch (error) {
      showToast(error?.message || "页面截图失败，请重试", {tone: "error"});
    } finally {
      shareButton.disabled = false;
      shareButton.removeAttribute("aria-busy");
    }
  };
  const mediaQuery = globalThis.window?.matchMedia?.(MOBILE_VIEWPORT_QUERY);
  const onViewportChange = (event) => {
    closeNavigation({returnFocus: false});
    if (!event.matches) setNavigationHidden(navigation, false);
  };
  menuButton.addEventListener("click", onMenuClick);
  backdrop.addEventListener("click", onBackdropClick);
  collapseButton.addEventListener("click", onCollapseClick);
  platformButton.addEventListener("click", onPlatformClick);
  refreshButton.addEventListener("click", onRefreshClick);
  shareButton?.addEventListener("click", onShareClick);
  document.addEventListener("keydown", handleNavigationKeys);
  mediaQuery?.addEventListener?.("change", onViewportChange);

  const cleanup = () => {
    filterNodes._cleanupPresetButtons?.();
    menuButton.removeEventListener("click", onMenuClick);
    backdrop.removeEventListener("click", onBackdropClick);
    collapseButton.removeEventListener("click", onCollapseClick);
    platformButton.removeEventListener("click", onPlatformClick);
    refreshButton.removeEventListener("click", onRefreshClick);
    shareButton?.removeEventListener("click", onShareClick);
    document.removeEventListener("keydown", handleNavigationKeys);
    mediaQuery?.removeEventListener?.("change", onViewportChange);
    document.body.classList.remove("navigation-open");
    if (previousPlatform === null) document.body?.removeAttribute("data-platform");
    else document.body?.setAttribute("data-platform", previousPlatform);
    root.classList.remove("app-shell");
    root.removeAttribute("data-navigation-collapsed");
    root.removeAttribute("data-navigation-open");
    root.replaceChildren(...originalNodes);
    for (const {node, parent, nextSibling} of [...filterPlacements].sort((a, b) => b.index - a.index)) {
      if (!parent) continue;
      parent.insertBefore(node, nextSibling?.parentNode === parent ? nextSibling : null);
    }
    if (mountedShell?.root === root) mountedShell = null;
  };
  mountedShell = {root, navigation, menuButton, collapseButton, backdrop, refreshButton, platformButton, shareButton, cleanup};
  setCollapsed(collapsedPreference);
  return cleanup;
}
