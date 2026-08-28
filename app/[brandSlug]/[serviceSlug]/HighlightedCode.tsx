"use client";

import { useEffect, useState } from "react";
import { highlightCode } from "@/lib/highlight";

export default function HighlightedCode({
  code,
  lang,
}: {
  code: string;
  lang: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setHtml(null);
    highlightCode(code, lang).then((h) => {
      if (active) setHtml(h);
    });
    return () => {
      active = false;
    };
  }, [code, lang]);

  if (html) {
    return (
      <div className="docs-shiki" dangerouslySetInnerHTML={{ __html: html }} />
    );
  }
  return (
    <pre className="docs-code-pre">
      <code>{code}</code>
    </pre>
  );
}