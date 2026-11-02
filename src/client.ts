// Minimal SightRadar REST client used by the MCP tools.
//
// It runs unchanged on Node 20+, Bun, Deno and Cloudflare Workers: only
// fetch, FormData, Blob and AbortSignal are used. Authentication is a
// pluggable header provider so the same client serves an API key from the
// environment (local stdio server) and a per-grant key (remote server).

export const DEFAULT_BASE_URL = "https://api.sightradar.com";
export const DEFAULT_TIMEOUT_MS = 120_000;

export interface SightRadarApiOptions {
  /** API key (`frs_...`). Sent as `Authorization: Bearer <key>`. */
  apiKey?: string;
  /** Alternative to `apiKey`: returns the auth headers for each request. */
  authHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  /** Injectable fetch (tests, Worker service bindings). */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  json?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  requestId?: string;
  creditsRemaining?: number;
}

/** A non-2xx answer from the API, carrying the stable error code when present. */
export class SightRadarApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly retryAfter?: string;
  readonly body: unknown;

  constructor(init: {
    status: number;
    message: string;
    code?: string;
    requestId?: string;
    retryAfter?: string;
    body?: unknown;
  }) {
    super(init.message);
    this.name = "SightRadarApiError";
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.retryAfter = init.retryAfter;
    this.body = init.body;
  }
}

export class SightRadarApi {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly authHeaders: () => Record<string, string> | Promise<Record<string, string>>;

  constructor(opts: SightRadarApiOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = opts.userAgent ?? "sightradar-mcp";
    // Bind so a Worker's global fetch is not called with a foreign `this`.
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    if (opts.authHeaders) {
      this.authHeaders = opts.authHeaders;
    } else if (opts.apiKey) {
      const key = opts.apiKey;
      this.authHeaders = () => ({ Authorization: `Bearer ${key}` });
    } else {
      throw new Error("SightRadarApi needs apiKey or authHeaders");
    }
  }

  get<T = unknown>(path: string, opts: RequestOptions = {}) {
    return this.request<T>("GET", path, opts);
  }
  post<T = unknown>(path: string, opts: RequestOptions = {}) {
    return this.request<T>("POST", path, opts);
  }
  put<T = unknown>(path: string, opts: RequestOptions = {}) {
    return this.request<T>("PUT", path, opts);
  }
  patch<T = unknown>(path: string, opts: RequestOptions = {}) {
    return this.request<T>("PATCH", path, opts);
  }
  delete<T = unknown>(path: string, opts: RequestOptions = {}) {
    return this.request<T>("DELETE", path, opts);
  }

  /** GET a binary resource (e.g. an invoice PDF). */
  async getBytes(path: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string }> {
    const res = await this.fetchImpl(this.baseUrl + path, {
      headers: { "User-Agent": this.userAgent, ...(await this.authHeaders()) },
      redirect: "manual",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text();
      let data: unknown = text;
      try {
        data = JSON.parse(text);
      } catch {
        // not JSON
      }
      throw new SightRadarApiError({
        status: res.status,
        ...describeError(res.status, data, res.headers.get("content-type") ?? ""),
        requestId: cleanRequestId(res.headers.get("x-request-id")),
        body: data,
      });
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new SightRadarApiError({ status: 413, code: "too_large", message: "The file is too large to return here." });
    }
    return { bytes: buf, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }

  async request<T = unknown>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.userAgent,
      ...(await this.authHeaders()),
      ...opts.headers,
    };
    let body: BodyInit | undefined;
    if (opts.form) {
      body = opts.form; // fetch sets the multipart boundary itself
    } else if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new SightRadarApiError({
        status: 0,
        code: timedOut ? "timeout" : "network_error",
        message: timedOut
          ? `SightRadar API did not answer within ${Math.round(this.timeoutMs / 1000)} s`
          : `Could not reach the SightRadar API: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const requestId = cleanRequestId(res.headers.get("x-request-id"));
    const credits = res.headers.get("x-credits-remaining");
    const text = await res.text();
    let data: unknown = text;
    const ct = res.headers.get("content-type") ?? "";
    if (text && ct.includes("json")) {
      try {
        data = JSON.parse(text);
      } catch {
        // keep raw text
      }
    } else if (!text) {
      data = null;
    }

    if (!res.ok) {
      throw new SightRadarApiError({
        status: res.status,
        ...describeError(res.status, data, ct),
        requestId,
        retryAfter: res.headers.get("retry-after") ?? undefined,
        body: data,
      });
    }

    return {
      status: res.status,
      data: data as T,
      requestId,
      creditsRemaining: credits !== null && credits !== "" && !Number.isNaN(Number(credits)) ? Number(credits) : undefined,
    };
  }
}

/**
 * The gateway and the engine can both set X-Request-Id, which arrives as
 * "a,a" (or "a, b"). Keep each distinct id once.
 */
function cleanRequestId(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  return ids.length ? ids.join(",") : undefined;
}

/** Pull `{code, message}` out of the gateway's (several) error body shapes. */
function describeError(status: number, data: unknown, contentType = ""): { code?: string; message: string } {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const detail = d.error_detail as Record<string, unknown> | undefined;
    const code =
      (typeof d.error_code === "string" && d.error_code) ||
      (typeof detail?.code === "string" && detail.code) ||
      (typeof d.code === "string" && d.code) ||
      undefined;
    const message =
      (typeof detail?.message === "string" && detail.message) ||
      (typeof d.error === "string" && d.error) ||
      (typeof d.message === "string" && d.message) ||
      (typeof d.detail === "string" && d.detail) ||
      `HTTP ${status}`;
    return { code: code || inferCode(status, message), message };
  }
  if (typeof data === "string" && data.trim()) {
    // An HTML page (a proxy or CDN error page in front of the API) is useless
    // to an assistant: say what happened instead of passing markup through.
    if (contentType.includes("html") || /^\s*</.test(data)) {
      return status >= 500 || status === 0
        ? { code: "upstream_unavailable", message: `SightRadar is temporarily unavailable (HTTP ${status}).` }
        : { code: inferCode(status, ""), message: `SightRadar refused the request (HTTP ${status}).` };
    }
    return { code: inferCode(status, data), message: data.trim().slice(0, 500) };
  }
  return { message: `HTTP ${status}` };
}

/**
 * Some gateway answers (the 429 rate and concurrency limits, 413) carry only a
 * message. Give them the same stable codes as the structured errors.
 */
function inferCode(status: number, message: string): string | undefined {
  const m = message.toLowerCase();
  if (status === 429 && m.includes("concurrency")) return "concurrency_limit_exceeded";
  if (status === 429) return "rate_limit_exceeded";
  if (status === 413) return "image_too_large";
  return undefined;
}

/** Percent-encode one path segment (collection ids may be arbitrary UTF-8). */
export function seg(value: string): string {
  return encodeURIComponent(value);
}
