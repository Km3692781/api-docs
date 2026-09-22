"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { GuidePage } from "@/lib/postman-normalize";

export default function GuidesView({ guide }: { guide: GuidePage | null }) {
  if (!guide) {
    return (
      <div className="docs-content-block docs-fade-slide">
        <h1 className="docs-page-title">Guides</h1>
        <p className="docs-empty-note">
          No guides yet. Add a description to the collection root or any folder
          in Postman, then re-upload.
        </p>
      </div>
    );
  }

  return (
    <div className="docs-guides-outer">
      <div className="docs-slide-scene">
        <article className="docs-slide-page docs-content-block" key={guide.slug}>
          <h1 className="docs-page-title">{guide.title}</h1>
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {guide.markdown}
            </ReactMarkdown>
          </div>
        </article>
      </div>
    </div>
  );
}
