(() => {
  const supported = new Set(["mt5", "domestic_futures"]);
  const params = new URLSearchParams(window.location.search);
  let platform = params.get("platform");
  if (!supported.has(platform)) {
    try {
      platform = localStorage.getItem("mt5-review-platform");
    } catch (_error) {
      platform = null;
    }
  }
  if (!supported.has(platform)) platform = "mt5";
  document.documentElement.dataset.platform = platform;
})();
