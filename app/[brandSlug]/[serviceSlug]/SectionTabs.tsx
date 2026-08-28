"use client";

export type DocsSection = "reference" | "guides" | "explorer" | "changelog";

const SECTIONS: { id: DocsSection; label: string }[] = [
  { id: "guides", label: "Guides" },
  { id: "reference", label: "Reference" },
  { id: "explorer", label: "Explorer" },
  { id: "changelog", label: "Changelog" },
];

export default function SectionTabs({
  active,
  onChange,
  hasGuides,
}: {
  active: DocsSection;
  onChange: (s: DocsSection) => void;
  hasGuides: boolean;
}) {
  return (
    <div
      className="docs-topbar-pills"
      role="tablist"
      aria-label="Documentation sections"
    >
      {SECTIONS.map((s) => {
        if (s.id === "guides" && !hasGuides) return null;
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            role="tab"
            aria-selected={isActive}
            className={`docs-topbar-pill${isActive ? " docs-topbar-pill-active" : ""}`}
            onClick={() => onChange(s.id)}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
