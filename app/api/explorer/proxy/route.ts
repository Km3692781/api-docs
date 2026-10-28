import { NextRequest, NextResponse } from "next/server";
import {
  createApiLogger,
  failResponse,
  snapshotRequest,
  withRequestId,
} from "@/lib/api-logger";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

function isPrivateIp(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) return true;
  if (hostname.endsWith(".local")) return true;
  // Basic IPv4 private ranges
  const m = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const log = createApiLogger("POST /api/explorer/proxy", req);
  log.ok("start");

  let body: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | null;
  };

  try {
    body = await req.json();
    log.ok("parse_json");
  } catch (err) {
    return failResponse(
      log,
      "parse_json",
      err instanceof Error ? err : new Error("Invalid JSON body"),
      NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
      snapshotRequest(req)
    );
  }

  const snap = () =>
    snapshotRequest(req, {
      jsonBody: {
        url: body.url,
        method: body.method,
        // Do not log upstream Authorization / body contents
        headers: body.headers
          ? Object.keys(body.headers)
          : undefined,
        hasBody: body.body != null && body.body !== "",
      },
    });

  const url = body.url?.trim();
  if (!url) {
    return failResponse(
      log,
      "validate_url",
      new Error("url is required"),
      NextResponse.json({ error: "url is required" }, { status: 400 }),
      snap()
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (err) {
    return failResponse(
      log,
      "validate_url",
      err instanceof Error ? err : new Error("Invalid URL"),
      NextResponse.json({ error: "Invalid URL" }, { status: 400 }),
      snap()
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return failResponse(
      log,
      "validate_url",
      new Error("Only http and https URLs are allowed"),
      NextResponse.json(
        { error: "Only http and https URLs are allowed" },
        { status: 400 }
      ),
      snap()
    );
  }

  if (isPrivateIp(parsed.hostname)) {
    return failResponse(
      log,
      "validate_url",
      new Error("Requests to private/local hosts are not allowed"),
      NextResponse.json(
        { error: "Requests to private/local hosts are not allowed" },
        { status: 400 }
      ),
      snap()
    );
  }
  log.ok("validate_url", {
    host: parsed.hostname,
    protocol: parsed.protocol,
  });

  const method = (body.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {};
  if (body.headers && typeof body.headers === "object") {
    for (const [k, v] of Object.entries(body.headers)) {
      if (!k || typeof v !== "string") continue;
      const lower = k.toLowerCase();
      // Block hop-by-hop / sensitive browser headers; allow Authorization for APIs
      if (lower === "host" || lower === "cookie" || lower === "connection") continue;
      headers[k] = v;
    }
  }
  log.ok("prepare_upstream", { method, headerCount: Object.keys(headers).length });

  const started = Date.now();
  try {
    const upstream = await fetch(url, {
      method,
      headers,
      body:
        method === "GET" || method === "HEAD"
          ? undefined
          : body.body ?? undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });

    const contentType = upstream.headers.get("content-type") ?? "";
    const text = await upstream.text();
    const responseHeaders: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    log.ok("upstream_fetch", {
      status: upstream.status,
      contentType,
      bodyBytes: text.length,
      durationMs: Date.now() - started,
    });
    log.done(200, {
      upstreamStatus: upstream.status,
      durationMs: Date.now() - started,
    });

    return withRequestId(
      NextResponse.json({
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
        body: text,
        contentType,
        durationMs: Date.now() - started,
      }),
      log.reqId
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return failResponse(
      log,
      "upstream_fetch",
      err,
      NextResponse.json(
        { error: message, durationMs: Date.now() - started },
        { status: 502 }
      ),
      snap(),
      { durationMs: Date.now() - started }
    );
  }
}
