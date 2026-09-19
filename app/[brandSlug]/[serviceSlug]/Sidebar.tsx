"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "@/lib/postman-normalize";
import type { GuidePage } from "@/lib/postman-normalize";
import type { DocsSection } from "./SectionTabs";
import BrandLogo from "./BrandLogo";

interface SidebarProps {
  rootName: string;
  nodes: TreeNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  logoUrl: string | null;
  brandName: string;
  mode: "light" | "dark";
  onToggleMode: () => void;
  isOpen: boolean;
  downloadUrl: string;
  /** When false, folder clicks only expand/collapse (Reference & Explorer). */
  foldersSelectable?: boolean;
  section: DocsSection;
  guides?: GuidePage[];
  selectedGuideSlug?: string;
  onSelectGuide?: (slug: string) => void;
}

function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  if (!q) return nodes;
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === "request") {
      if (
        node.name.toLowerCase().includes(q) ||
        node.method.toLowerCase().includes(q) ||
        node.url.toLowerCase().includes(q)
      ) {
        result.push(node);
      }
    } else {
      const folderMatches = node.name.toLowerCase().includes(q);
      if (folderMatches) {
        result.push(node);
      } else {
        const filteredChildren = filterTree(node.children, q);
        if (filteredChildren.length > 0) {
          result.push({ ...node, children: filteredChildren });
        }
      }
    }
  }
  return result;
}

function countRequests(nodes: TreeNode[]): number {
  let c = 0;
  for (const n of nodes) {
    if (n.kind === "request") c++;
    else c += countRequests(n.children);
  }
  return c;
}

function getAncestorIds(id: string): string[] {
  const parts = id.split("-");
  const ancestors: string[] = [];
  for (let i = 2; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join("-"));
  }
  return ancestors;
}

export default function Sidebar({
  rootName,
  nodes,
  selectedId,
  onSelect,
  logoUrl,
  brandName,
  mode,
  onToggleMode,
  isOpen,
  downloadUrl,
  foldersSelectable = false,
  section,
  guides = [],
  selectedGuideSlug,
  onSelectGuide,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const searching = normalizedQuery.length > 0;

  const filtered = useMemo(
    () => filterTree(nodes, normalizedQuery),
    [nodes, normalizedQuery]
  );

  const resultCount = useMemo(() => countRequests(filtered), [filtered]);

  useEffect(() => {
    if (!selectedId) return;
    const ancestors = getAncestorIds(selectedId);
    if (ancestors.length) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        ancestors.forEach((a) => next.add(a));
        return next;
      });
    }
    const t = setTimeout(() => {
      const el = treeRef.current?.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(selectedId)}"]`
      );
      el?.scrollIntoView({ block: "nearest" });
    }, 30);
    return () => clearTimeout(t);
  }, [selectedId]);

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const showEndpointTree = section === "reference" || section === "explorer";
  const showGuidesNav = section === "guides";

  return (
    <aside className={`docs-sidebar ${isOpen ? "docs-sidebar-open" : ""}`}>
      <div className="docs-sidebar-header">
        <div className="docs-sidebar-logo-row">
          {logoUrl ? (
            <BrandLogo src={logoUrl} alt={brandName} className="docs-sidebar-logo" />
          ) : (
            <span style={{ fontWeight: 700, fontSize: "16px", letterSpacing: "-0.01em" }}>
              {brandName}
            </span>
          )}
          <button
            onClick={onToggleMode}
            aria-label="Toggle light/dark theme"
            role="switch"
            aria-checked={mode === "dark"}
            className="docs-theme-toggle"
            style={{
              background: mode === "dark" ? "var(--brand-primary)" : "#cbd5e1",
            }}
          >
            <span
              className="docs-theme-knob"
              style={{ left: mode === "dark" ? "23px" : "3px" }}
            >
              {mode === "dark" ? "🌙" : "☀️"}
            </span>
          </button>
        </div>

        {showEndpointTree && (
          <>
            <div className="docs-search-wrap">
              <svg
                className="docs-search-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search endpoints…"
                className="docs-search-input"
                spellCheck={false}
              />
              {searching ? (
                <button
                  className="docs-search-clear"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              ) : (
                <kbd className="docs-search-kbd">/</kbd>
              )}
            </div>
            {searching && (
              <div className="docs-search-count" key={resultCount}>
                {resultCount} {resultCount === 1 ? "result" : "results"}
              </div>
            )}
          </>
        )}

        <a href={downloadUrl} className="docs-download-btn" download>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download Collection
        </a>
      </div>

      <div className="docs-tree" ref={treeRef}>
        {showEndpointTree && (
          <>
            {!searching && (
              <div className="docs-sidebar-rootlabel">{rootName}</div>
            )}

            {filtered.length === 0 ? (
              <div className="docs-search-empty">
                No endpoints match “{query.trim()}”
              </div>
            ) : (
              filtered.map((node) => (
                <TreeNodeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  expandedIds={expandedIds}
                  onToggle={toggle}
                  forceOpen={searching}
                  query={normalizedQuery}
                  foldersSelectable={foldersSelectable}
                />
              ))
            )}
          </>
        )}

        {showGuidesNav && (
          <>
            <div className="docs-sidebar-rootlabel">Guides</div>
            {guides.map((g) => {
              const active = g.slug === selectedGuideSlug;
              return (
                <button
                  key={g.id}
                  className={`docs-nav-item${active ? " docs-nav-item-selected" : ""}`}
                  style={{ paddingLeft: `${12 + g.depth * 13}px` }}
                  onClick={() => onSelectGuide?.(g.slug)}
                >
                  <span className="docs-nav-label">{g.title}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="docs-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function TreeNodeItem({
  node,
  depth,
  selectedId,
  onSelect,
  expandedIds,
  onToggle,
  forceOpen,
  query,
  foldersSelectable,
}: {
  node: TreeNode;
  depth: number;
  selectedId: string;
  onSelect: (id: string) => void;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  forceOpen: boolean;
  query: string;
  foldersSelectable: boolean;
}) {
  const indent = 10 + depth * 13;
  const isSelected =
    node.kind === "request"
      ? node.id === selectedId
      : foldersSelectable && node.id === selectedId;
  const effectiveOpen = forceOpen || expandedIds.has(node.id);

  const baseClass = isSelected
    ? "docs-nav-item docs-nav-item-selected"
    : "docs-nav-item";

  if (node.kind === "folder") {
    return (
      <div>
        <button
          className={`${baseClass} docs-nav-folder`}
          data-node-id={node.id}
          onClick={() => {
            onToggle(node.id);
            if (foldersSelectable) onSelect(node.id);
          }}
          style={{ paddingLeft: `${indent}px` }}
        >
          <span
            className="docs-folder-caret"
            style={{
              transform: effectiveOpen ? "rotate(90deg)" : "rotate(0deg)",
            }}
          >
            ▶
          </span>
          <span className="docs-nav-label">
            <Highlight text={node.name} query={query} />
          </span>
        </button>
        {effectiveOpen && (
          <div className="docs-folder-children">
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.id}
                node={child}
                depth={depth + 1}
                selectedId={selectedId}
                onSelect={onSelect}
                expandedIds={expandedIds}
                onToggle={onToggle}
                forceOpen={forceOpen}
                query={query}
                foldersSelectable={foldersSelectable}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className={`${baseClass} docs-nav-request`}
      data-node-id={node.id}
      onClick={() => onSelect(node.id)}
      style={{ paddingLeft: `${indent + 4}px` }}
    >
      <span className={`docs-method-pill docs-method-${node.method}`}>
        {node.method}
      </span>
      <span className="docs-nav-label">
        <Highlight text={node.name} query={query} />
      </span>
    </button>
  );
}
