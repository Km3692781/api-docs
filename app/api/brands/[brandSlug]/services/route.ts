import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { convertPostmanToOpenApi } from "@/lib/converter";
import { diffOpenApiSpecs, isEmptyDiff } from "@/lib/openapi-diff";
import {
  createApiLogger,
  failResponse,
  snapshotRequest,
  withRequestId,
} from "@/lib/api-logger";

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

/** GET /api/brands/:brandSlug/services — list services for a brand */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ brandSlug: string }> }
) {
  const { brandSlug } = await params;
  const log = createApiLogger(
    "GET /api/brands/[brandSlug]/services",
    req,
    { brandSlug }
  );
  log.ok("start", { brandSlug });

  const snap = () => snapshotRequest(req, { params: { brandSlug } });

  try {
    const brandResult = await pool.query(
      `SELECT id FROM api_docs.brands WHERE slug = $1`,
      [brandSlug]
    );

    if (brandResult.rowCount === 0) {
      return failResponse(
        log,
        "resolve_brand",
        new Error(`brand "${brandSlug}" not found`),
        NextResponse.json(
          { error: `brand "${brandSlug}" not found` },
          { status: 404 }
        ),
        snap()
      );
    }

    const brandId = brandResult.rows[0].id;
    log.ok("resolve_brand", { brandId });

    const result = await pool.query(
      `SELECT id, slug, name, created_at, updated_at
       FROM api_docs.services
       WHERE brand_id = $1
       ORDER BY name ASC`,
      [brandId]
    );
    log.ok("db_list", { count: result.rowCount ?? 0 });
    log.done(200, { count: result.rowCount ?? 0 });
    return withRequestId(
      NextResponse.json({ services: result.rows }),
      log.reqId
    );
  } catch (err) {
    return failResponse(
      log,
      "db_list",
      err,
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      snap()
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ brandSlug: string }> }
) {
  const { brandSlug } = await params;
  const log = createApiLogger(
    "POST /api/brands/[brandSlug]/services",
    req,
    { brandSlug }
  );
  log.ok("start", { brandSlug });

  let formData: FormData;
  try {
    formData = await req.formData();
    log.ok("parse_form");
  } catch (err) {
    return failResponse(
      log,
      "parse_form",
      err instanceof Error ? err : new Error("Request must be multipart/form-data"),
      NextResponse.json(
        { error: "Request must be multipart/form-data" },
        { status: 400 }
      ),
      snapshotRequest(req, { params: { brandSlug } })
    );
  }

  const snap = () => snapshotRequest(req, { params: { brandSlug }, formData });

  const name = formData.get("name");
  const slug = formData.get("slug");
  const file = formData.get("collection");

  if (!name || typeof name !== "string") {
    return failResponse(
      log,
      "validate_fields",
      new Error("name is required"),
      NextResponse.json({ error: "name is required" }, { status: 400 }),
      snap()
    );
  }

  if (!slug || typeof slug !== "string") {
    return failResponse(
      log,
      "validate_fields",
      new Error("slug is required"),
      NextResponse.json({ error: "slug is required" }, { status: 400 }),
      snap()
    );
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return failResponse(
      log,
      "validate_slug",
      new Error("slug must only contain lowercase letters, numbers, and hyphens"),
      NextResponse.json(
        { error: "slug must only contain lowercase letters, numbers, and hyphens" },
        { status: 400 }
      ),
      snap()
    );
  }

  if (!file || !(file instanceof File)) {
    return failResponse(
      log,
      "validate_fields",
      new Error("collection file is required"),
      NextResponse.json(
        { error: "collection file is required" },
        { status: 400 }
      ),
      snap()
    );
  }

  if (!file.name.endsWith(".json")) {
    return failResponse(
      log,
      "validate_fields",
      new Error("collection must be a .json file"),
      NextResponse.json(
        { error: "collection must be a .json file" },
        { status: 400 }
      ),
      snap(),
      { fileName: file.name }
    );
  }
  log.ok("validate_fields", {
    name,
    slug,
    fileName: file.name,
    fileSize: file.size,
  });

  let postmanCollection: object;
  try {
    const text = await file.text();
    postmanCollection = JSON.parse(text);
    log.ok("parse_collection_json", { bytes: text.length });
  } catch (err) {
    return failResponse(
      log,
      "parse_collection_json",
      err instanceof Error ? err : new Error("collection file is not valid JSON"),
      NextResponse.json(
        { error: "collection file is not valid JSON" },
        { status: 400 }
      ),
      snap()
    );
  }

  const brandResult = await pool.query(
    `SELECT id FROM api_docs.brands WHERE slug = $1`,
    [brandSlug]
  );

  if (brandResult.rowCount === 0) {
    return failResponse(
      log,
      "resolve_brand",
      new Error(`brand "${brandSlug}" not found`),
      NextResponse.json(
        { error: `brand "${brandSlug}" not found` },
        { status: 404 }
      ),
      snap()
    );
  }

  const brandId = brandResult.rows[0].id;
  log.ok("resolve_brand", { brandId });

  let openapiSpec: object;
  try {
    openapiSpec = await convertPostmanToOpenApi(postmanCollection);
    log.ok("convert_postman", {
      pathCount: Object.keys(
        (openapiSpec as { paths?: Record<string, unknown> }).paths ?? {}
      ).length,
    });
  } catch (err) {
    return failResponse(
      log,
      "convert_postman",
      err,
      NextResponse.json(
        {
          error:
            "Failed to convert Postman collection to OpenAPI. Check that your collection is valid.",
        },
        { status: 422 }
      ),
      snap()
    );
  }

  const client = await pool.connect();
  try {
    await ensureVersionsTable();
    log.ok("ensure_versions_table");
    await client.query("BEGIN");
    log.ok("db_begin");

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

    const shouldRecordVersion = isInitial || !isEmptyDiff(diff);
    log.ok("diff_openapi", {
      isInitial,
      shouldRecordVersion,
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
    });

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
    log.ok("db_upsert_service", { serviceId: service.id, slug: service.slug });

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
      log.ok("db_insert_version", { isInitial });
    } else {
      log.ok("db_insert_version_skipped", { reason: "empty_diff" });
    }

    await client.query("COMMIT");
    log.ok("db_commit");
    log.done(201, { serviceId: service.id, slug: service.slug });
    return withRequestId(
      NextResponse.json({ service }, { status: 201 }),
      log.reqId
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return failResponse(
      log,
      "db_upsert",
      err,
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      snap()
    );
  } finally {
    client.release();
  }
}
