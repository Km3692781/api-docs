"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildTree,
  findFirstRequest,
  findPath,
  flattenRequests,
  buildSlugMaps,
  extractGuides,
} from "@/lib/postman-normalize";
import type { TreeNode } from "@/lib/postman-normalize";
import type { PostmanCollection } from "@/lib/postman-types";
import { deriveTheme, getDefaultMode } from "@/lib/theme-derive";
import type { ThemeMode } from "@/lib/theme-derive";
import Sidebar from "./Sidebar";
import RequestView from "./RequestView";
import GuidesView from "./GuidesView";
import ExplorerView from "./ExplorerView";
import ChangelogView, { type ChangelogEntry } from "./ChangelogView";
import ShortcutOverlay from "./ShortcutOverlay";
import SectionTabs, { type DocsSection } from "./SectionTabs";

interface BrandColors {
  primary?: string;
  accent?: string;
}

interface DocsClientProps {
  brandName: string;
  brandSlug: string;
  serviceSlug: string;
  hasLogo: boolean;
  theme: BrandColors;
  serviceName: string;
  collection: PostmanCollection;
  changelog: ChangelogEntry[];
}

function parseHash(hash: string): {
  section: DocsSection;
  slug: string | null;
} {
  const raw = hash.replace(/^#/, "").trim();
  if (!raw) return { section: "guides", slug: null };

  if (raw === "changelog" || raw.startsWith("changelog/")) {
    return { section: "changelog", slug: null };
  }
  if (raw.startsWith("guides/")) {
    return { section: "guides", slug: raw.slice("guides/".length) || null };
  }
  if (raw.startsWith("guide/")) {
    return { section: "guides", slug: raw.slice("guide/".length) || null };
  }
  if (raw.startsWith("explorer/")) {
    return { section: "explorer", slug: raw.slice("explorer/".length) || null };
  }
  if (raw.startsWith("reference/")) {
    return {
      section: "reference",
      slug: raw.slice("reference/".length) || null,
    };
  }
  // Bare request slug → Reference deep link
  return { section: "reference", slug: raw };
}

function writeHash(section: DocsSection, slug: string | null) {
  let next = "";
  if (section === "changelog") next = "changelog";
  else if (section === "guides") next = slug ? `guides/${slug}` : "guides";
  else if (section === "explorer")
    next = slug ? `explorer/${slug}` : "explorer";
  else next = slug ? slug : "";

  const url = next ? `#${next}` : window.location.pathname + window.location.search;
  window.history.replaceState(null, "", next ? `#${next}` : url.split("#")[0]);
}

export default function DocsClient({
  brandName,
  brandSlug,
  serviceSlug,
  hasLogo,
  theme,
  serviceName,
  collection,
  changelog,
}: DocsClientProps) {
  const [mode, setMode] = useState<ThemeMode>("light");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [view, setView] = useState<
    "all" | "description" | "request" | "responses"
  >("all");
  const [section, setSection] = useState<DocsSection>("guides");

  useEffect(() => {
    setMode(getDefaultMode());
  }, []);

  useEffect(() => {
    if (!hasLogo) return;
    const href = `/api/brands/${brandSlug}/logo?variant=icon`;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/svg+xml";
    link.href = href;
  }, [hasLogo, brandSlug]);

  const derived = useMemo(() => deriveTheme(theme, mode), [theme, mode]);
  const tree = useMemo(() => buildTree(collection), [collection]);
  const slugMaps = useMemo(() => buildSlugMaps(tree.nodes), [tree.nodes]);
  const guides = useMemo(
    () => extractGuides(tree.rootName, tree.rootDescription, tree.nodes),
    [tree]
  );
  const hasGuides = guides.length > 0;

  const [selectedId, setSelectedId] = useState<string>(
    () => findFirstRequest(tree.nodes)?.id ?? ""
  );
  const [selectedGuideSlug, setSelectedGuideSlug] = useState<string>(
    () => guides[0]?.slug ?? ""
  );

  // Honor deep link on mount
  useEffect(() => {
    const { section: s, slug } = parseHash(window.location.hash);
    let nextSection = s;
    if (nextSection === "guides" && !hasGuides) nextSection = "reference";
    setSection(nextSection);

    if (slug) {
      if (nextSection === "guides") {
        if (guides.some((g) => g.slug === slug)) setSelectedGuideSlug(slug);
      } else if (nextSection === "reference" || nextSection === "explorer") {
        const id = slugMaps.slugToId[slug];
        if (id) {
          // Only select requests
          const path = findPath(tree.nodes, id);
          const leaf = path[path.length - 1];
          if (leaf?.kind === "request") setSelectedId(id);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep hash in sync
  useEffect(() => {
    if (section === "guides") {
      writeHash("guides", selectedGuideSlug || null);
    } else if (section === "changelog") {
      writeHash("changelog", null);
    } else {
      const slug = slugMaps.idToSlug[selectedId] ?? null;
      writeHash(section, slug);
    }
  }, [section, selectedId, selectedGuideSlug, slugMaps]);

  const selectedNode = useMemo(
    () => findNodeById(tree.nodes, selectedId),
    [tree.nodes, selectedId]
  );

  const ancestors = useMemo(() => {
    const path = findPath(tree.nodes, selectedId);
    return path.slice(0, -1);
  }, [tree.nodes, selectedId]);

  const requestOrder = useMemo(
    () => flattenRequests(tree.nodes),
    [tree.nodes]
  );

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setSidebarOpen(false);
  };

  const handleSectionChange = (s: DocsSection) => {
    if (s === "guides" && !hasGuides) return;
    setSection(s);
    setSidebarOpen(false);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.tagName === "SELECT";

      if (e.key === "?" && !inInput) {
        e.preventDefault();
        setShowHelp(true);
        return;
      }

      if (e.key === "/" && !inInput) {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>(".docs-search-input")
          ?.focus();
        return;
      }

      if (e.key === "Escape") {
        if (showHelp) {
          setShowHelp(false);
          return;
        }
        if (sidebarOpen) setSidebarOpen(false);
        if (inInput) (target as HTMLInputElement).blur();
        return;
      }

      if (
        (section === "reference" || section === "explorer") &&
        (e.key === "ArrowDown" || e.key === "ArrowUp") &&
        !inInput
      ) {
        e.preventDefault();
        const idx = requestOrder.findIndex((n) => n.id === selectedId);
        if (idx === -1) return;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const next = idx + delta;
        if (next >= 0 && next < requestOrder.length) {
          setSelectedId(requestOrder[next].id);
        }
      }

      if (section === "guides" && (e.key === "ArrowDown" || e.key === "ArrowUp") && !inInput) {
        e.preventDefault();
        const idx = guides.findIndex((g) => g.slug === selectedGuideSlug);
        if (idx === -1) return;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const next = idx + delta;
        if (next >= 0 && next < guides.length) {
          setSelectedGuideSlug(guides[next].slug);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    requestOrder,
    selectedId,
    sidebarOpen,
    showHelp,
    section,
    guides,
    selectedGuideSlug,
  ]);

  const logoUrl = hasLogo ? `/api/brands/${brandSlug}/logo` : null;
  const selectedGuide =
    guides.find((g) => g.slug === selectedGuideSlug) ?? guides[0] ?? null;

  const mobileTitle =
    section === "guides"
      ? selectedGuide?.title ?? "Guides"
      : section === "changelog"
        ? "Changelog"
        : section === "explorer"
          ? selectedNode?.kind === "request"
            ? selectedNode.name
            : "Explorer"
          : selectedNode?.kind === "request"
            ? selectedNode.name
            : serviceName;

  return (
    <div
      className={`docs-root ${mode === "dark" ? "docs-dark" : "docs-light"}`}
      style={
        {
          "--brand-primary": derived.primary,
          "--brand-accent": derived.accent,
          "--brand-primary-soft": derived.primarySoft,
          "--brand-accent-soft": derived.accentSoft,
          "--brand-background": derived.contentBg,
          "--brand-surface": derived.surface,
          "--brand-surface-hover": derived.surfaceHover,
          "--brand-shadow-sm": derived.shadowSm,
          "--brand-shadow-md": derived.shadowMd,
          "--brand-nav-bg": derived.navBg,
          "--brand-nav-text": derived.navText,
          "--brand-nav-text-muted": derived.navTextMuted,
          "--brand-nav-border": derived.navBorder,
          "--brand-content-text": derived.contentText,
          "--brand-content-text-muted": derived.contentTextMuted,
          "--brand-content-border": derived.contentBorder,
          "--brand-content-code-bg": derived.contentCodeBg,
          "--brand-content-table-stripe": derived.contentTableStripeBg,
          "--brand-code-text": derived.inlineCodeText,
          display: "flex",
          height: "100vh",
          width: "100%",
          background: derived.contentBg,
          fontFamily:
            "var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        } as React.CSSProperties
      }
    >
      {sidebarOpen && (
        <div
          className="docs-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        rootName={tree.rootName}
        nodes={tree.nodes}
        selectedId={selectedId}
        onSelect={handleSelect}
        logoUrl={logoUrl}
        brandName={brandName}
        mode={mode}
        onToggleMode={() => setMode((m) => (m === "light" ? "dark" : "light"))}
        isOpen={sidebarOpen}
        downloadUrl={`/api/brands/${brandSlug}/services/${serviceSlug}/download`}
        foldersSelectable={false}
        section={section}
        guides={guides}
        selectedGuideSlug={selectedGuide?.slug}
        onSelectGuide={(slug) => {
          setSelectedGuideSlug(slug);
          setSidebarOpen(false);
        }}
      />

      <main
        id="docs-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          background: "var(--brand-background)",
          color: "var(--brand-content-text)",
          minWidth: 0,
        }}
      >
        <div className="docs-mobile-bar">
          <button
            className="docs-hamburger"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <span />
            <span />
            <span />
          </button>
          <span className="docs-mobile-title">{mobileTitle}</span>
        </div>

        <div className="docs-topbar">
          <SectionTabs
            active={section}
            onChange={handleSectionChange}
            hasGuides={hasGuides}
          />
        </div>

        {section === "reference" &&
          (selectedNode?.kind === "request" ? (
            <RequestView
              node={selectedNode}
              serviceName={serviceName}
              derived={derived}
              ancestors={ancestors}
              slug={slugMaps.idToSlug[selectedNode.id]}
              view={view}
              onViewChange={setView}
            />
          ) : (
            <div className="docs-content-block docs-fade-slide">
              <h1 className="docs-page-title">{serviceName}</h1>
              <p className="docs-empty-note">
                Select an endpoint from the sidebar to view its documentation.
              </p>
            </div>
          ))}

        {section === "guides" && <GuidesView guide={selectedGuide} />}

        {section === "explorer" && (
          <ExplorerView nodes={tree.nodes} selectedId={selectedId} />
        )}

        {section === "changelog" && <ChangelogView entries={changelog} />}
      </main>

      <button
        className="docs-help-fab"
        onClick={() => setShowHelp(true)}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
      >
        ?
      </button>

      <ShortcutOverlay open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}

function findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.kind === "folder") {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}
