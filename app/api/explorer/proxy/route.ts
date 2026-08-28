import { NextRequest, NextResponse } from "next/server";

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
  let body: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only http and https URLs are allowed" },
      { status: 400 }
    );
  }

  if (isPrivateIp(parsed.hostname)) {
    return NextResponse.json(
      { error: "Requests to private/local hosts are not allowed" },
      { status: 400 }
    );
  }

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

    return NextResponse.json({
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
      body: text,
      contentType,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message, durationMs: Date.now() - started },
      { status: 502 }
    );
  }
}
