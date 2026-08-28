"use client";

export default function ShortcutOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  const shortcuts = [
    { keys: ["/"], desc: "Focus search" },
    { keys: ["↑", "↓"], desc: "Navigate endpoints / guides" },
    { keys: ["Esc"], desc: "Close search / dialogs" },
    { keys: ["?"], desc: "Show this help" },
  ];

  return (
    <div className="docs-modal-backdrop" onClick={onClose}>
      <div
        className="docs-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="docs-modal-head">
          <span>Keyboard shortcuts</span>
          <button
            className="docs-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <ul className="docs-shortcut-list">
          {shortcuts.map((s, i) => (
            <li key={i}>
              <span className="docs-shortcut-keys">
                {s.keys.map((k, j) => (
                  <kbd key={j}>{k}</kbd>
                ))}
              </span>
              <span>{s.desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
