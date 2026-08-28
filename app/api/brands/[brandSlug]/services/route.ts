import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { convertPostmanToOpenApi } from "@/lib/converter";
import { diffOpenApiSpecs, isEmptyDiff } from "@/lib/openapi-diff";

async function ensureVersionsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_docs.service_versions (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      service_id    UUID NOT NULL REFERENCES api_docs.services(id) ON DELETE CASCADE,
      openapi_spec  JSONB NOT NULL,
      diff_summary  JSONB NOT NULL DEFAULT '{}',
      is_initial    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS service_versions_service_created_idx
      ON api_docs.service_versions (service_id, created_at DESC)
  `);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ brandSlug: string }> }
) {
  const { brandSlug } = await params;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data" },
      { status: 400 }
    );
  }

  const name = formData.get("name");
  const slug = formData.get("slug");
  const file = formData.get("collection");

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (!slug || typeof slug !== "string") {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { error: "slug must only contain lowercase letters, numbers, and hyphens" },
      { status: 400 }
    );
  }

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "collection file is required" },
      { status: 400 }
    );
  }

  if (!file.name.endsWith(".json")) {
    return NextResponse.json(
      { error: "collection must be a .json file" },
      { status: 400 }
    );
  }

  let postmanCollection: object;
  try {
    const text = await file.text();
    postmanCollection = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "collection file is not valid JSON" },
      { status: 400 }
    );
  }

  const brandResult = await pool.query(
    `SELECT id FROM api_docs.brands WHERE slug = $1`,
    [brandSlug]
  );

  if (brandResult.rowCount === 0) {
    return NextResponse.json(
      { error: `brand "${brandSlug}" not found` },
      { status: 404 }
    );
  }

  const brandId = brandResult.rows[0].id;

  let openapiSpec: object;
  try {
    openapiSpec = await convertPostmanToOpenApi(postmanCollection);
  } catch (err) {
    console.error("Conversion error:", err);
    return NextResponse.json(
      {
        error:
          "Failed to convert Postman collection to OpenAPI. Check that your collection is valid.",
      },
      { status: 422 }
    );
  }

  const client = await pool.connect();
  try {
    await ensureVersionsTable();
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id, openapi_spec FROM api_docs.services
       WHERE brand_id = $1 AND slug = $2`,
      [brandId, slug]
    );

    const previousSpec =
      existing.rowCount && existing.rowCount > 0
        ? existing.rows[0].openapi_spec
        : null;

    let priorVersions = 0;
    if (existing.rowCount && existing.rowCount > 0) {
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS c FROM api_docs.service_versions WHERE service_id = $1`,
        [existing.rows[0].id]
      );
      priorVersions = countResult.rows[0]?.c ?? 0;
    }

    const isInitial = !previousSpec || priorVersions === 0;

    const diff = isInitial
      ? { added: [], removed: [], changed: [] }
      : diffOpenApiSpecs(previousSpec, openapiSpec);

    // Skip version row when re-upload has no API surface changes (still update service)
    const shouldRecordVersion = isInitial || !isEmptyDiff(diff);

    const result = await client.query(
      `INSERT INTO api_docs.services (brand_id, slug, name, openapi_spec, source_collection)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (brand_id, slug)
       DO UPDATE SET
         name = EXCLUDED.name,
         openapi_spec = EXCLUDED.openapi_spec,
         source_collection = EXCLUDED.source_collection
       RETURNING id, slug, name, created_at, updated_at`,
      [
        brandId,
        slug,
        name,
        JSON.stringify(openapiSpec),
        JSON.stringify(postmanCollection),
      ]
    );

    const service = result.rows[0];

    if (shouldRecordVersion) {
      await client.query(
        `INSERT INTO api_docs.service_versions
           (service_id, openapi_spec, diff_summary, is_initial)
         VALUES ($1, $2, $3, $4)`,
        [
          service.id,
          JSON.stringify(openapiSpec),
          JSON.stringify(diff),
          isInitial,
        ]
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ service }, { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Upsert service error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
