"use client";

import { useEffect, useMemo, useState } from "react";
import type { RequestNode, TreeNode } from "@/lib/postman-normalize";
import { findFirstRequest } from "@/lib/postman-normalize";
import HighlightedCode from "./HighlightedCode";

interface KvRow {
  key: string;
  value: string;
  enabled: boolean;
}

interface ExplorerResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  contentType: string;
  durationMs: number;
}

function findRequest(nodes: TreeNode[], id: string): RequestNode | null {
  for (const n of nodes) {
    if (n.kind === "request" && n.id === id) return n;
    if (n.kind === "folder") {
      const found = findRequest(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

function rowsFromHeaders(node: RequestNode): KvRow[] {
  return node.headers
    .filter((h) => !h.disabled)
    .map((h) => ({ key: h.key, value: h.value, enabled: true }));
}

function guessBodyLang(contentType: string, body: string): string {
  const ct = contentType.toLowerCase();
  if (
    ct.includes("json") ||
    body.trim().startsWith("{") ||
    body.trim().startsWith("[")
  ) {
    return "json";
  }
  if (ct.includes("xml")) return "xml";
  if (ct.includes("html")) return "html";
  return "text";
}

function prettyBody(body: string, lang: string): string {
  if (lang === "json") {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

function statusTone(code: number): string {
  if (code >= 200 && code < 300) return "success";
  if (code >= 300 && code < 400) return "info";
  if (code >= 400 && code < 500) return "warn";
  if (code >= 500) return "error";
  return "unknown";
}

export default function ExplorerView({
  nodes,
  selectedId,
}: {
  nodes: TreeNode[];
  selectedId: string;
}) {
  const selectedNode = useMemo(
    () => findRequest(nodes, selectedId) ?? findFirstRequest(nodes),
    [nodes, selectedId]
  );

  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("GET");
  const [headerRows, setHeaderRows] = useState<KvRow[]>([]);
  const [bodyText, setBodyText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ExplorerResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedNode) return;
    setUrl(selectedNode.url);
    setMethod(selectedNode.method);
    setHeaderRows(rowsFromHeaders(selectedNode));
    setBodyText(selectedNode.body?.content ?? "");
    setResult(null);
    setError(null);
  }, [selectedNode?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRow = (index: number, patch: Partial<KvRow>) => {
    setHeaderRows((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r))
    );
  };

  const send = async () => {
    if (!url.trim()) {
      setError("URL is required");
      return;
    }
    setSending(true);
    setError(null);
    setResult(null);

    const headers: Record<string, string> = {};
    for (const row of headerRows) {
      if (row.enabled && row.key.trim()) headers[row.key.trim()] = row.value;
    }

    try {
      const res = await fetch("/api/explorer/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          method,
          headers,
          body: method === "GET" || method === "HEAD" ? null : bodyText || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }
      setResult(data as ExplorerResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSending(false);
    }
  };

  const bodyLang = result
    ? guessBodyLang(result.contentType, result.body)
    : "json";
  const displayBody = result ? prettyBody(result.body, bodyLang) : "";

  if (!selectedNode) {
    return (
      <div className="docs-content-block docs-fade-slide">
        <h1 className="docs-page-title">API Explorer</h1>
        <p className="docs-empty-note">Select an endpoint to try it out.</p>
      </div>
    );
  }

  return (
    <div className="docs-explorer-main docs-fade-slide" key={selectedNode.id}>
      <div className="docs-explorer-head">
        <h1 className="docs-page-title" style={{ marginBottom: 0 }}>
          {selectedNode.name}
        </h1>
        <p className="docs-explorer-sub">
          Edit the request and send it through the docs proxy.
        </p>
      </div>

      <div className="docs-explorer-bar">
        <select
          className="docs-explorer-method"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          aria-label="HTTP method"
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(
            (m) => (
              <option key={m} value={m}>
                {m}
              </option>
            )
          )}
        </select>
        <input
          className="docs-explorer-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          aria-label="Request URL"
        />
        <button
          className="docs-explorer-send"
          onClick={send}
          disabled={sending}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>

      <div className="docs-explorer-panels">
        <section className="docs-explorer-panel">
          <div className="docs-section-label">Headers</div>
          <div className="docs-param-card">
            {headerRows.length === 0 && (
              <div className="docs-param-row">
                <span className="docs-param-desc">No headers</span>
              </div>
            )}
            {headerRows.map((row, i) => (
              <div key={i} className="docs-explorer-kv-row">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => updateRow(i, { enabled: e.target.checked })}
                  aria-label={`Enable ${row.key || "header"}`}
                />
                <input
                  className="docs-explorer-input"
                  value={row.key}
                  onChange={(e) => updateRow(i, { key: e.target.value })}
                  placeholder="Header"
                  spellCheck={false}
                />
                <input
                  className="docs-explorer-input"
                  value={row.value}
                  onChange={(e) => updateRow(i, { value: e.target.value })}
                  placeholder="Value"
                  spellCheck={false}
                />
              </div>
            ))}
            <button
              className="docs-explorer-add"
              type="button"
              onClick={() =>
                setHeaderRows((r) => [
                  ...r,
                  { key: "", value: "", enabled: true },
                ])
              }
            >
              + Add header
            </button>
          </div>

          {method !== "GET" && method !== "HEAD" && (
            <div style={{ marginTop: 22 }}>
              <div className="docs-section-label">Body</div>
              <textarea
                className="docs-explorer-body"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                spellCheck={false}
                rows={10}
              />
            </div>
          )}
        </section>

        <section className="docs-explorer-panel">
          <div className="docs-section-label">Response</div>
          {error && (
            <div className="docs-explorer-error" role="alert">
              {error}
            </div>
          )}
          {!error && !result && (
            <p className="docs-empty-note">
              Response will appear here after you send a request.
            </p>
          )}
          {result && (
            <div className="docs-code-window docs-fade-slide">
              <div className="docs-code-window-head">
                <span
                  className={`docs-status-dot docs-status-${statusTone(
                    result.status
                  )}`}
                />
                <span className="docs-code-window-label">
                  {result.status} {result.statusText}
                </span>
                <span
                  className="docs-code-window-label"
                  style={{ marginLeft: "auto" }}
                >
                  {result.durationMs} ms
                </span>
              </div>
              <HighlightedCode
                code={displayBody || "(empty)"}
                lang={bodyLang}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
