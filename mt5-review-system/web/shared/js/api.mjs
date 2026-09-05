export class HttpError extends Error {
  constructor(status, message) {
    super(message || `请求失败：${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

export async function requestJson(path, { method = "GET", body, signal } = {}) {
  const options = { method, signal };
  const hasBody = body !== undefined && body !== null;
  if (hasBody) {
    options.headers = { "Content-Type": "application/json" };
    options.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const response = await fetch(path, options);

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || data?.message || `请求失败：${response.status}`;
    throw new HttpError(response.status, message);
  }
  return data;
}

export class RequestGate {
  constructor() {
    this.controllers = new Map();
  }

  begin(key) {
    const existing = this.controllers.get(key);
    if (existing && !existing.signal.aborted) existing.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);
    return controller;
  }

  async run(key, requestFactory) {
    const controller = this.begin(key);
    try {
      return await requestFactory(controller.signal);
    } finally {
      if (this.controllers.get(key) === controller) this.controllers.delete(key);
    }
  }

  abortAll() {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}
