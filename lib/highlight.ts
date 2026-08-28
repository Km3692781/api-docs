import type { Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

const LANGS = [
  "bash", "javascript", "python", "go", "php",
  "java", "csharp", "ruby", "json", "xml", "graphql", "html",
];

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({ themes: ["github-dark"], langs: LANGS })
    );
  }
  return highlighterPromise;
}

export async function highlightCode(
  code: string,
  lang: string
): Promise<string | null> {
  try {
    const hl = await getHighlighter();
    const loaded = hl.getLoadedLanguages() as string[];
    const useLang = loaded.includes(lang) ? lang : "text";
    return hl.codeToHtml(code, { lang: useLang, theme: "github-dark" });
  } catch {
    return null;
  }
}