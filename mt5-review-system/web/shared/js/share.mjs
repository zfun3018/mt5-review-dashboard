function pageSize(documentRef) {
  const html = documentRef.documentElement;
  const body = documentRef.body;
  return {
    width: Math.max(html?.scrollWidth || 0, html?.clientWidth || 0, body?.scrollWidth || 0, body?.clientWidth || 0, 1),
    height: Math.max(html?.scrollHeight || 0, html?.clientHeight || 0, body?.scrollHeight || 0, body?.clientHeight || 0, 1),
  };
}

async function renderPageToBlob({documentRef, windowRef}) {
  const renderer = windowRef?.html2canvas || globalThis.html2canvas;
  if (!documentRef?.body || typeof renderer !== "function") {
    throw new Error("当前浏览器不支持生成页面截图");
  }
  await documentRef.fonts?.ready?.catch?.(() => undefined);
  await Promise.all([...(documentRef.images || [])].map((image) => {
    if (typeof image.decode !== "function") return undefined;
    return image.decode().catch(() => undefined);
  }));
  const {width, height} = pageSize(documentRef);
  const scale = Math.min(windowRef.devicePixelRatio || 1, 2);
  const canvas = await renderer(documentRef.body, {
    backgroundColor: windowRef.getComputedStyle(documentRef.body).backgroundColor || null,
    allowTaint: false,
    ignoreElements: (element) => element.hasAttribute?.("data-share-exclude"),
    logging: false,
    scale,
    useCORS: true,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    scrollX: 0,
    scrollY: 0,
  });
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("页面截图生成失败，请重试")), "image/png");
  });
}

function downloadBlob(blob, {windowRef, documentRef, filename}) {
  const url = windowRef.URL.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = filename;
  link.setAttribute("data-share-download", "true");
  link.click();
  link.remove();
  windowRef.setTimeout(() => windowRef.URL.revokeObjectURL(url), 0);
}

async function copyBlob(blob, navigatorRef, windowRef) {
  const ClipboardItemConstructor = windowRef.ClipboardItem || globalThis.ClipboardItem;
  if (!navigatorRef?.clipboard?.write || !ClipboardItemConstructor) return false;
  await navigatorRef.clipboard.write([new ClipboardItemConstructor({"image/png": blob})]);
  return true;
}

export async function sharePageScreenshot({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  navigatorRef = globalThis.navigator,
  filename = `mt5-review-${new Date().toISOString().slice(0, 10)}.png`,
} = {}) {
  const blob = await renderPageToBlob({documentRef, windowRef});
  downloadBlob(blob, {windowRef, documentRef, filename});
  let copied = false;
  try {
    copied = await copyBlob(blob, navigatorRef, windowRef);
  } catch (_error) {
    copied = false;
  }
  return {downloaded: true, copied};
}
