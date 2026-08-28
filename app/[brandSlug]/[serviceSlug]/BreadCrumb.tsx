"use client";

import type { TreeNode } from "@/lib/postman-normalize";

export default function Breadcrumb({
  serviceName,
  ancestors,
}: {
  serviceName: string;
  ancestors: TreeNode[];
  /** @deprecated Folders are no longer selectable in Reference. */
  onSelect?: (id: string) => void;
}) {
  return (
    <nav className="docs-breadcrumb" aria-label="Breadcrumb">
      <span className="docs-breadcrumb-item">
        <span className="docs-breadcrumb-root">{serviceName}</span>
        {ancestors.length > 0 && <span className="docs-breadcrumb-sep">›</span>}
      </span>
      {ancestors.map((node, i) => (
        <span key={node.id} className="docs-breadcrumb-item">
          <span className="docs-breadcrumb-link docs-breadcrumb-static">
            {node.name}
          </span>
          {i < ancestors.length - 1 && (
            <span className="docs-breadcrumb-sep">›</span>
          )}
        </span>
      ))}
    </nav>
  );
}
