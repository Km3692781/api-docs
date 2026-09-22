import Link from "next/link";

export default function DocsNotFound() {
  return (
    <main className="docs-not-found">
      <div className="docs-not-found-card">
        <p className="docs-not-found-code">404</p>
        <h1 className="docs-not-found-title">Docs link not found</h1>
        <p className="docs-not-found-body">
          This documentation link is missing, invalid, or no longer active.
          Ask your provider for a current access URL.
        </p>
        <Link href="/" className="docs-not-found-link">
          Back to home
        </Link>
      </div>
    </main>
  );
}
