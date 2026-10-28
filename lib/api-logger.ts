import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const REDACTED = "[REDACTED]";
const SENSITIVE_HEADER =
  /^(authorization|cookie|set-cookie|x-api-key|x-signature|x-signing-secret)$/i;
const MAX_STRING = 2000;
const MAX_JSON_DEPTH = 6;

export type RequestSnapshot = {
  method: string;
  path: string;
  url: string;
  query: Record<string, string>;
  params?: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
};

export type ApiLogger = {
  reqId: string;
  route: string;
  /** Successful checkpoint */
  ok: (step: string, meta?: Record<string, unknown>) => void;
  /** Failed checkpoint — includes error details + optional request snapshot */
  fail: (
    step: string,
    error: unknown,
    request?: RequestSnapshot | null,
    meta?: Record<string, unknown>
  ) => void;
  /** Final outcome of the request */
  done: (status: number, meta?: Record<string, unknown>) => void;
};

function truncate(value: string, max = MAX_STRING): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_JSON_DEPTH) return "[max-depth]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => sanitizeValue(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_HEADER.test(k) || /secret|password|token|api[_-]?key/i.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = sanitizeValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      ...(typeof (error as { code?: unknown }).code !== "undefined"
        ? { code: (error as { code?: unknown }).code }
        : {}),
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

function redactHeaders(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    out[key] = SENSITIVE_HEADER.test(key) ? REDACTED : truncate(value, 500);
  });
  return out;
}

export function summarizeFormData(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  formData.forEach((value, key) => {
    if (value instanceof File) {
      out[key] = {
        type: "file",
        name: value.name,
        mimeType: value.type || null,
        size: value.size,
      };
    } else if (typeof value === "string") {
      // Avoid dumping huge theme/base64-ish fields in full
      if (/logo|base64|collection/i.test(key) && value.length > 200) {
        out[key] = truncate(value, 200);
      } else {
        out[key] = truncate(value);
      }
    } else {
      out[key] = String(value);
    }
  });
  return out;
}

export function snapshotRequest(
  req: NextRequest,
  opts?: {
    params?: Record<string, string>;
    formData?: FormData;
    jsonBody?: unknown;
  }
): RequestSnapshot {
  const query: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  let body: unknown;
  if (opts?.formData) {
    body = { kind: "multipart/form-data", fields: summarizeFormData(opts.formData) };
  } else if (opts?.jsonBody !== undefined) {
    body = { kind: "json", data: sanitizeValue(opts.jsonBody) };
  }

  return {
    method: req.method,
    path: req.nextUrl.pathname,
    url: req.nextUrl.toString(),
    query,
    params: opts?.params,
    headers: redactHeaders(req),
    body,
  };
}

export function createApiLogger(
  route: string,
  req: NextRequest,
  params?: Record<string, string>
): ApiLogger {
  const reqId = randomUUID();
  const started = Date.now();
  const base = {
    reqId,
    route,
    method: req.method,
    path: req.nextUrl.pathname,
    params: params ?? undefined,
  };

  const write = (
    level: "info" | "error",
    payload: Record<string, unknown>
  ) => {
    const line = JSON.stringify({
      ...base,
      ...payload,
      elapsedMs: Date.now() - started,
      ts: new Date().toISOString(),
    });
    if (level === "error") console.error(line);
    else console.log(line);
  };

  return {
    reqId,
    route,
    ok(step, meta) {
      write("info", { step, ok: true, ...(meta ? { meta: sanitizeValue(meta) } : {}) });
    },
    fail(step, error, request, meta) {
      write("error", {
        step,
        ok: false,
        error: errorDetails(error),
        ...(request ? { request } : {}),
        ...(meta ? { meta: sanitizeValue(meta) } : {}),
      });
    },
    done(status, meta) {
      write(status >= 400 ? "error" : "info", {
        step: "done",
        ok: status < 400,
        status,
        ...(meta ? { meta: sanitizeValue(meta) } : {}),
      });
    },
  };
}

/** Attach X-Request-Id without changing status/body. */
export function withRequestId(
  res: NextResponse,
  reqId: string
): NextResponse {
  res.headers.set("X-Request-Id", reqId);
  return res;
}

/** Convenience: log fail + done for a client/validation error response. */
export function failResponse(
  log: ApiLogger,
  step: string,
  error: unknown,
  res: NextResponse,
  request?: RequestSnapshot | null,
  meta?: Record<string, unknown>
): NextResponse {
  log.fail(step, error, request, meta);
  log.done(res.status, meta);
  return withRequestId(res, log.reqId);
}
