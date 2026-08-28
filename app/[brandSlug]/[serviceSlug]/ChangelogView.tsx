"use client";

import type { DiffChange, OpenApiDiffSummary } from "@/lib/openapi-diff";

export interface ChangelogEntry {
  id: string;
  createdAt: string;
  isInitial: boolean;
  diff: OpenApiDiffSummary;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function ChangeList({
  title,
  items,
  tone,
}: {
  title: string;
  items: DiffChange[];
  tone: "added" | "removed" | "changed";
}) {
  if (items.length === 0) return null;
  return (
    <div className="docs-changelog-group">
      <div className={`docs-changelog-group-label docs-changelog-${tone}`}>
        {title}
        <span className="docs-changelog-count">{items.length}</span>
      </div>
      <ul className="docs-changelog-list">
        {items.map((c, i) => (
          <li key={`${c.path}-${c.method}-${i}`}>
            {c.method && (
              <span className={`docs-method-pill docs-method-${c.method}`}>
                {c.method}
              </span>
            )}
            <code className="docs-changelog-path">{c.path}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ChangelogView({ entries }: { entries: ChangelogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="docs-content-block docs-fade-slide">
        <h1 className="docs-page-title">Changelog</h1>
        <p className="docs-empty-note">No changelog as of now.</p>
      </div>
    );
  }

  return (
    <div className="docs-content-block docs-fade-slide docs-changelog">
      <h1 className="docs-page-title">Changelog</h1>
      <p className="docs-changelog-intro">
        Automatically generated from collection uploads — added and removed
        endpoints between versions.
      </p>

      <div className="docs-changelog-timeline">
        {entries.map((entry, index) => {
          const { added, removed, changed } = entry.diff;
          const total = added.length + removed.length + changed.length;
          return (
            <div
              key={entry.id}
              className="docs-changelog-entry"
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
            >
              <div className="docs-changelog-rail" aria-hidden="true">
                <span className="docs-changelog-dot" />
              </div>
              <div className="docs-changelog-card">
                <div className="docs-changelog-card-head">
                  <time dateTime={entry.createdAt}>
                    {formatDate(entry.createdAt)}
                  </time>
                  {entry.isInitial ? (
                    <span className="docs-changelog-badge">Initial publish</span>
                  ) : (
                    <span className="docs-changelog-badge docs-changelog-badge-muted">
                      {total} change{total === 1 ? "" : "s"}
                    </span>
                  )}
                </div>

                {entry.isInitial ? (
                  <p className="docs-empty-note" style={{ margin: 0 }}>
                    First version of this API documentation was published.
                  </p>
                ) : (
                  <>
                    <ChangeList title="Added" items={added} tone="added" />
                    <ChangeList title="Removed" items={removed} tone="removed" />
                    <ChangeList title="Changed" items={changed} tone="changed" />
                    {total === 0 && (
                      <p className="docs-empty-note" style={{ margin: 0 }}>
                        No endpoint path changes detected.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
