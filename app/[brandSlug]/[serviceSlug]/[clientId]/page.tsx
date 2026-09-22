import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import DocsClient from "../DocsClient";
import type { PostmanCollection } from "@/lib/postman-types";
import type { ChangelogEntry } from "../ChangelogView";
import type { OpenApiDiffSummary } from "@/lib/openapi-diff";
import {
  collectRequestPathnames,
  filterChangelogDiff,
  filterCollectionByAllowlist,
  isUuid,
  parseFolderAllowlist,
} from "@/lib/folder-access";

interface PageProps {
  params: Promise<{
    brandSlug: string;
    serviceSlug: string;
    clientId: string;
  }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { brandSlug, serviceSlug, clientId } = await params;
  if (!isUuid(clientId)) return { title: "Not Found" };

  const result = await pool.query(
    `SELECT b.name as brand_name, s.name as service_name, c.name as client_name,
            (b.logo_base64 IS NOT NULL) AS has_logo
     FROM api_docs.doc_clients c
     JOIN api_docs.services s ON s.id = c.service_id
     JOIN api_docs.brands b ON b.id = c.brand_id
     WHERE b.slug = $1 AND s.slug = $2 AND c.id = $3`,
    [brandSlug, serviceSlug, clientId]
  );
  if (result.rowCount === 0) return { title: "Not Found" };
  const { brand_name, service_name, client_name, has_logo } = result.rows[0];
  return {
    title: `${service_name} — ${brand_name} (${client_name})`,
    // Prefer brand logo over any default app icon so reloads stay consistent
    ...(has_logo
      ? {
          icons: {
            icon: [
              {
                url: `/api/brands/${brandSlug}/logo?variant=icon`,
                type: "image/png",
              },
            ],
            shortcut: `/api/brands/${brandSlug}/logo?variant=icon`,
          },
        }
      : { icons: {} }),
  };
}

async function loadChangelog(
  serviceId: string,
  allowedPathnames: Set<string> | "all"
): Promise<ChangelogEntry[]> {
  try {
    const result = await pool.query(
      `SELECT id, created_at, is_initial, diff_summary
       FROM api_docs.service_versions
       WHERE service_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [serviceId]
    );

    return result.rows.map((row) => {
      const raw = (row.diff_summary ?? {
        added: [],
        removed: [],
        changed: [],
      }) as OpenApiDiffSummary;
      return {
        id: row.id as string,
        createdAt: new Date(row.created_at).toISOString(),
        isInitial: Boolean(row.is_initial),
        diff: filterChangelogDiff(raw, allowedPathnames),
      };
    });
  } catch (err) {
    console.warn("Changelog load skipped:", err);
    return [];
  }
}

export default async function ClientDocsPage({ params }: PageProps) {
  const { brandSlug, serviceSlug, clientId } = await params;

  if (!isUuid(clientId)) notFound();

  const result = await pool.query(
    `SELECT
       s.id                AS service_id,
       b.name              AS brand_name,
       b.slug              AS brand_slug,
       b.logo_base64       AS logo_base64,
       b.theme             AS theme,
       s.name              AS service_name,
       s.source_collection AS source_collection,
       c.name              AS client_name,
       c.folder_allowlist  AS folder_allowlist
     FROM api_docs.doc_clients c
     JOIN api_docs.services s ON s.id = c.service_id
     JOIN api_docs.brands b ON b.id = c.brand_id
     WHERE b.slug = $1 AND s.slug = $2 AND c.id = $3`,
    [brandSlug, serviceSlug, clientId]
  );

  if (result.rowCount === 0) notFound();

  const row = result.rows[0];
  if (!row.source_collection) notFound();

  const allowlist = parseFolderAllowlist(row.folder_allowlist);
  const fullCollection = row.source_collection as PostmanCollection;
  const collection = filterCollectionByAllowlist(fullCollection, allowlist);

  const allowedPathnames =
    allowlist === "all"
      ? ("all" as const)
      : collectRequestPathnames(collection);

  const changelog = await loadChangelog(row.service_id, allowedPathnames);

  return (
    <DocsClient
      brandName={row.brand_name}
      brandSlug={row.brand_slug}
      serviceSlug={serviceSlug}
      clientId={clientId}
      hasLogo={!!row.logo_base64}
      theme={row.theme}
      serviceName={row.service_name}
      collection={collection}
      changelog={changelog}
      accessScoped={allowlist !== "all"}
    />
  );
}
