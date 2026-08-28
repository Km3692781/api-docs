"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RequestNode, NormalParam, TreeNode } from "@/lib/postman-normalize";
import { generateSnippet, CODE_LANGUAGES } from "@/lib/postman-normalize";
import type { DerivedTheme } from "@/lib/theme-derive";
import Breadcrumb from "./BreadCrumb";
import HighlightedCode from "./HighlightedCode";

type ViewMode = "all" | "description" | "request" | "responses";

export default function RequestView({
  node,
  serviceName,
  ancestors,
  slug,
  view,
  onViewChange,
}: {
  node: RequestNode;
  serviceName: string;
  derived?: DerivedTheme;
  ancestors: TreeNode[];
  slug: string;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
}) {
  const hasPath = node.pathVariables.filter((p) => !p.disabled).length > 0;
  const hasQuery = node.queryParams.filter((p) => !p.disabled).length > 0;
  const hasHeaders = node.headers.filter((h) => !h.disabled).length > 0;

  const showLeft = view === "all" || view === "description";
  const showCode = view === "all" || view === "request" || view === "responses";
  const isSingleColumn = view !== "all";

  return (
    <div className="docs-request-outer">
      <div className="docs-view-bar">
        <Breadcrumb serviceName={serviceName} ancestors={ancestors} />
        <div className="docs-view-select-wrap">
          <label className="docs-view-label">View</label>
          <select
            className="docs-view-select"
            value={view}
            onChange={(e) => onViewChange(e.target.value as ViewMode)}
          >
            <option value="all">All</option>
            <option value="description">Description</option>
            <option value="request">Request</option>
            <option value="responses">Responses</option>
          </select>
        </div>
      </div>

      {/* Page-turn wrapper: re-mounts on request or view change */}
      <div className="docs-turn-scene">
        <div
          className="docs-turn-page"
          key={`${node.id}-${view}`}
        >
          <div
            className={`docs-request-grid ${
              isSingleColumn ? "docs-request-grid-single" : ""
            }`}
          >
            {showLeft && (
              <div style={{ minWidth: 0 }}>
                <div className="docs-title-row">
                  <h1 className="docs-page-title">{node.name}</h1>
                  <CopyLinkButton slug={slug} />
                </div>

                {(view === "all" || view === "description") && (
                  <div className="docs-endpoint-hero">
                    <span className={`docs-method-pill docs-method-${node.method} docs-method-lg`}>
                      {node.method}
                    </span>
                    <span className="docs-endpoint-url">{node.url}</span>
                    <CopyIconButton text={node.url} label="Copy URL" />
                  </div>
                )}

                {node.description ? (
                  <div className="markdown-body" style={{ marginBottom: "28px" }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {node.description}
                    </ReactMarkdown>
                  </div>
                ) : (
                  view === "description" && (
                    <p className="docs-empty-note">
                      No description provided for this endpoint.
                    </p>
                  )
                )}

                {view === "all" && hasPath && (
                  <ParamTable title="Path Variables" params={node.pathVariables} />
                )}
                {view === "all" && hasQuery && (
                  <ParamTable title="Query Parameters" params={node.queryParams} />
                )}
                {view === "all" && hasHeaders && (
                  <ParamTable
                    title="Headers"
                    params={node.headers.map((h) => ({
                      key: h.key,
                      value: h.value,
                      description: h.description,
                      disabled: h.disabled,
                    }))}
                  />
                )}
              </div>
            )}

            {showCode && (
              <div className={isSingleColumn ? "docs-code-column-single" : "docs-code-column"}>
                {isSingleColumn && (
                  <div className="docs-title-row" style={{ marginBottom: "18px" }}>
                    <h1 className="docs-page-title">{node.name}</h1>
                    <CopyLinkButton slug={slug} />
                  </div>
                )}

                {(view === "all" || view === "request") && (
                  <>
                    <CodePanel node={node} />
                    {node.body && (
                      <div className="docs-code-window" style={{ marginTop: "16px" }}>
                        <div className="docs-code-window-head">
                          <span className="docs-code-window-label">Request Body</span>
                          <div style={{ marginLeft: "auto" }}>
                            <CopyIconButton text={node.body.content} label="Copy" dark />
                          </div>
                        </div>
                        <HighlightedCode code={node.body.content} lang={node.body.language} />
                      </div>
                    )}
                  </>
                )}

                {(view === "all" || view === "responses") &&
                  (node.responses.length > 0 ? (
                    <div style={{ marginTop: view === "all" ? "20px" : 0 }}>
                      <ResponsePanel node={node} />
                    </div>
                  ) : (
                    view === "responses" && (
                      <p className="docs-empty-note">
                        No example responses saved for this endpoint.
                      </p>
                    )
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="docs-section-label">{children}</div>;
}

function ParamTable({ title, params }: { title: string; params: NormalParam[] }) {
  const active = params.filter((p) => !p.disabled);
  if (active.length === 0) return null;

  return (
    <div style={{ marginBottom: "28px" }}>
      <SectionLabel>{title}</SectionLabel>
      <div className="docs-param-card">
        {active.map((p, i) => (
          <div
            key={i}
            className="docs-param-row"
            style={{
              borderBottom:
                i < active.length - 1 ? "1px solid var(--brand-content-border)" : "none",
            }}
          >
            <div className="docs-param-top">
              <code className="docs-param-key">{p.key}</code>
              {p.value && <span className="docs-param-val">{p.value}</span>}
            </div>
            {p.description && <span className="docs-param-desc">{p.description}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function CodePanel({ node }: { node: RequestNode }) {
  const [lang, setLang] = useState<string>("curl");
  const code = generateSnippet(node, lang);
  const active = CODE_LANGUAGES.find((l) => l.key === lang);

  return (
    <div className="docs-code-window">
      <div className="docs-code-window-head">
        <div className="docs-window-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="docs-code-window-label">{active?.label ?? "Request"}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="docs-lang-select"
          >
            {CODE_LANGUAGES.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
          <CopyIconButton text={code} label="Copy" dark />
        </div>
      </div>
      <HighlightedCode code={code} lang={active?.syntax ?? "bash"} />
    </div>
  );
}

function ResponsePanel({ node }: { node: RequestNode }) {
  const [active, setActive] = useState(0);
  const safeActive = active < node.responses.length ? active : 0;
  const resp = node.responses[safeActive];
  if (!resp) return null;

  return (
    <div>
      <SectionLabel>Example Responses</SectionLabel>
      <div className="docs-response-tabs">
        {node.responses.map((r, i) => (
          <button
            key={r.id}
            onClick={() => setActive(i)}
            className={`docs-response-tab ${
              safeActive === i ? "docs-response-tab-active" : ""
            }`}
          >
            <span className={`docs-status-dot docs-status-${statusClass(r.code)}`} />
            {formatResponseLabel(r.code, r.name)}
          </button>
        ))}
      </div>
      <div className="docs-code-window">
        <div className="docs-code-window-head">
          <span className="docs-code-window-label">{resp.status || "Response"}</span>
          <div style={{ marginLeft: "auto" }}>
            <CopyIconButton text={resp.body} label="Copy" dark />
          </div>
        </div>
        <HighlightedCode code={resp.body} lang={resp.language} />
      </div>
    </div>
  );
}

function CopyIconButton({
  text,
  label,
  dark,
}: {
  text: string;
  label: string;
  dark?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      onClick={copy}
      className={`docs-copy-btn ${dark ? "docs-copy-btn-dark" : ""} ${
        copied ? "docs-copy-btn-done" : ""
      }`}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

function CopyLinkButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${slug}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      onClick={copy}
      className={`docs-anchor-btn ${copied ? "docs-anchor-btn-done" : ""}`}
      aria-label={copied ? "Link copied" : "Copy link to this endpoint"}
      title="Copy link"
    >
      {copied ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )}
    </button>
  );
}

function statusClass(code: number | null): string {
  if (code === null) return "unknown";
  if (code >= 200 && code < 300) return "success";
  if (code >= 300 && code < 400) return "info";
  if (code >= 400 && code < 500) return "warn";
  if (code >= 500) return "error";
  return "unknown";
}

function formatResponseLabel(code: number | null, name: string): string {
  if (code === null) return name;
  const codeStr = String(code);
  if (name.trim().startsWith(codeStr)) return name;
  return `${codeStr} ${name}`;
}