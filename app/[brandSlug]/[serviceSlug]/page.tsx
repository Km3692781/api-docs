import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import DocsClient from "./DocsClient";
import type { PostmanCollection } from "@/lib/postman-types";
import type { ChangelogEntry } from "./ChangelogView";
import type { OpenApiDiffSummary } from "@/lib/openapi-diff";

interface PageProps {
  params: Promise<{ brandSlug: string; serviceSlug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { brandSlug, serviceSlug } = await params;
  const result = await pool.query(
    `SELECT b.name as brand_name, s.name as service_name
     FROM api_docs.services s JOIN api_docs.brands b ON b.id = s.brand_id
     WHERE b.slug = $1 AND s.slug = $2`,
    [brandSlug, serviceSlug]
  );
  if (result.rowCount === 0) return { title: "Not Found" };
  const { brand_name, service_name } = result.rows[0];
  return {
    title: `${service_name} — ${brand_name} API Docs`,
  };
}

async function loadChangelog(serviceId: string): Promise<ChangelogEntry[]> {
  try {
    const result = await pool.query(
      `SELECT id, created_at, is_initial, diff_summary
       FROM api_docs.service_versions
       WHERE service_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [serviceId]
    );

    return result.rows.map((row) => ({
      id: row.id as string,
      createdAt: new Date(row.created_at).toISOString(),
      isInitial: Boolean(row.is_initial),
      diff: (row.diff_summary ?? {
        added: [],
        removed: [],
        changed: [],
      }) as OpenApiDiffSummary,
    }));
  } catch (err) {
    // Table may not exist yet before first upload with the new schema
    console.warn("Changelog load skipped:", err);
    return [];
  }
}

export default async function DocsPage({ params }: PageProps) {
  const { brandSlug, serviceSlug } = await params;

  const result = await pool.query(
    `SELECT
       s.id               AS service_id,
       b.name             AS brand_name,
       b.slug             AS brand_slug,
       b.logo_base64      AS logo_base64,
       b.theme            AS theme,
       s.name             AS service_name,
       s.source_collection AS source_collection
     FROM api_docs.services s
     JOIN api_docs.brands b ON b.id = s.brand_id
     WHERE b.slug = $1 AND s.slug = $2`,
    [brandSlug, serviceSlug]
  );

  if (result.rowCount === 0) notFound();

  const row = result.rows[0];

  if (!row.source_collection) {
    notFound();
  }

  const changelog = await loadChangelog(row.service_id);

  return (
    <DocsClient
      brandName={row.brand_name}
      brandSlug={row.brand_slug}
      serviceSlug={serviceSlug}
      hasLogo={!!row.logo_base64}
      theme={row.theme}
      serviceName={row.service_name}
      collection={row.source_collection as PostmanCollection}
      changelog={changelog}
    />
  );
}
