function createElement(tagName, className, text) {
  const node = document.createElement(tagName);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderRegionState(
  container,
  {state, message, onRetry, retryLabel = "重试"},
) {
  container.replaceChildren();
  if (!state || state === "idle") return null;
  const region = createElement("div", `region-state region-state--${state}`);
  region.setAttribute("role", state === "error" ? "alert" : "status");
  region.setAttribute("aria-live", state === "error" ? "assertive" : "polite");
  region.append(createElement("p", "region-state__message", message || ""));
  if (state === "error" && typeof onRetry === "function") {
    const retry = createElement("button", "region-state__retry", retryLabel);
    retry.setAttribute("type", "button");
    retry.addEventListener("click", onRetry);
    region.append(retry);
  }
  container.append(region);
  return region;
}

export function showToast(message, {tone = "info", duration = 2200} = {}) {
  const toast = createElement(
    "div",
    `feedback-toast feedback-toast--${tone}`,
    message,
  );
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
  document.body.append(toast);
  let timer = null;
  const dispose = () => {
    if (timer !== null) globalThis.clearTimeout(timer);
    toast.remove();
  };
  if (duration > 0) timer = globalThis.setTimeout(dispose, duration);
  return dispose;
}
