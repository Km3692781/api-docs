import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { convertPostmanToOpenApi } from "@/lib/converter";
import { diffOpenApiSpecs, isEmptyDiff } from "@/lib/openapi-diff";
import { isPgUniqueViolation, validateSlug } from "@/lib/form-validators";
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

/** DELETE /api/brands/:brand/:service — cascades versions + clients */
export async function DELETE(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ brandSlug: string; serviceSlug: string }> }
) {
  const { brandSlug, serviceSlug } = await params;
  const log = createApiLogger(
    "DELETE /api/brands/[brandSlug]/services/[serviceSlug]",
    req,
    { brandSlug, serviceSlug }
  );
  log.ok("start", { brandSlug, serviceSlug });

  const snap = () =>
    snapshotRequest(req, { params: { brandSlug, serviceSlug } });

  try {
    const result = await pool.query(
      `DELETE FROM api_docs.services s
       USING api_docs.brands b
       WHERE s.brand_id = b.id
         AND b.slug = $1
         AND s.slug = $2
       RETURNING s.id, s.slug, s.name`,
      [brandSlug, serviceSlug]
    );

    if (result.rowCount === 0) {
      return failResponse(
        log,
        "db_delete",
        new Error(
          `service "${serviceSlug}" not found for brand "${brandSlug}"`
        ),
        NextResponse.json(
          {
            error: `service "${serviceSlug}" not found for brand "${brandSlug}"`,
          },
          { status: 404 }
        ),
        snap()
      );
    }

    const service = result.rows[0];
    log.ok("db_delete", { serviceId: service.id, slug: service.slug });
    log.done(200, { serviceId: service.id });
    return withRequestId(
      NextResponse.json({ ok: true, service }),
      log.reqId
    );
  } catch (err) {
    return failResponse(
      log,
      "db_delete",
      err,
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      snap()
    );
  }
}

export async function PATCH(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ brandSlug: string; serviceSlug: string }> }
) {
  const { brandSlug, serviceSlug } = await params;
  const log = createApiLogger(
    "PATCH /api/brands/[brandSlug]/services/[serviceSlug]",
    req,
    { brandSlug, serviceSlug }
  );
  log.ok("start", { brandSlug, serviceSlug });

  let formData: FormData;
  try {
    formData = await req.formData();
    log.ok("parse_form");
  } catch (err) {
    return failResponse(
      log,
      "parse_form",
      err instanceof Error
        ? err
        : new Error("Request must be multipart/form-data"),
      NextResponse.json(
        { error: "Request must be multipart/form-data" },
        { status: 400 }
      ),
      snapshotRequest(req, { params: { brandSlug, serviceSlug } })
    );
  }

  const snap = () =>
    snapshotRequest(req, { params: { brandSlug, serviceSlug }, formData });

  const name = formData.get("name");
  const slug = formData.get("slug");
  const file = formData.get("collection");

  const hasName = typeof name === "string" && name.length > 0;
  const hasSlug = typeof slug === "string" && slug.length > 0;
  const hasCollection = file instanceof File && file.size > 0;

  if (!hasName && !hasSlug && !hasCollection) {
    return failResponse(
      log,
      "validate_fields",
      new Error("Provide at least one of: name, slug, collection"),
      NextResponse.json(
        { error: "Provide at least one of: name, slug, collection" },
        { status: 400 }
      ),
      snap()
    );
  }

  if (hasSlug) {
    const slugErr = validateSlug(slug as string);
    if (slugErr) {
      return failResponse(
        log,
        "validate_slug",
        new Error(slugErr),
        NextResponse.json({ error: slugErr }, { status: 400 }),
        snap()
      );
    }
  }
  log.ok("validate_fields", { hasName, hasSlug, hasCollection });

  let postmanCollection: object | undefined;
  let openapiSpec: object | undefined;

  if (hasCollection) {
    if (!(file as File).name.endsWith(".json")) {
      return failResponse(
        log,
        "validate_collection",
        new Error("collection must be a .json file"),
        NextResponse.json(
          { error: "collection must be a .json file" },
          { status: 400 }
        ),
        snap(),
        { fileName: (file as File).name }
      );
    }
    try {
      const text = await (file as File).text();
      postmanCollection = JSON.parse(text);
      log.ok("parse_collection_json", { bytes: text.length });
    } catch (err) {
      return failResponse(
        log,
        "parse_collection_json",
        err instanceof Error
          ? err
          : new Error("collection file is not valid JSON"),
        NextResponse.json(
          { error: "collection file is not valid JSON" },
          { status: 400 }
        ),
        snap()
      );
    }

    try {
      openapiSpec = await convertPostmanToOpenApi(postmanCollection!);
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
  }

  const client = await pool.connect();
  try {
    await ensureVersionsTable();
    log.ok("ensure_versions_table");
    await client.query("BEGIN");
    log.ok("db_begin");

    const existing = await client.query(
      `SELECT s.id, s.slug, s.name, s.openapi_spec, s.source_collection
       FROM api_docs.services s
       JOIN api_docs.brands b ON b.id = s.brand_id
       WHERE b.slug = $1 AND s.slug = $2
       FOR UPDATE OF s`,
      [brandSlug, serviceSlug]
    );

    if (existing.rowCount === 0) {
      await client.query("ROLLBACK");
      return failResponse(
        log,
        "resolve_service",
        new Error(
          `service "${serviceSlug}" not found for brand "${brandSlug}"`
        ),
        NextResponse.json(
          {
            error: `service "${serviceSlug}" not found for brand "${brandSlug}"`,
          },
          { status: 404 }
        ),
        snap()
      );
    }
    log.ok("resolve_service", { serviceId: existing.rows[0].id });

    const row = existing.rows[0];
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (hasName) {
      sets.push(`name = $${i++}`);
      values.push(name);
    }
    if (hasSlug) {
      sets.push(`slug = $${i++}`);
      values.push(slug);
    }
    if (hasCollection && openapiSpec && postmanCollection) {
      sets.push(`openapi_spec = $${i++}`);
      values.push(JSON.stringify(openapiSpec));
      sets.push(`source_collection = $${i++}`);
      values.push(JSON.stringify(postmanCollection));
    }

    values.push(row.id);

    const result = await client.query(
      `UPDATE api_docs.services
       SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING id, slug, name, created_at, updated_at`,
      values
    );

    const service = result.rows[0];
    log.ok("db_update_service", { serviceId: service.id, slug: service.slug });

    if (hasCollection && openapiSpec) {
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS c FROM api_docs.service_versions WHERE service_id = $1`,
        [row.id]
      );
      const priorVersions = countResult.rows[0]?.c ?? 0;
      const isInitial = priorVersions === 0;
      const diff = isInitial
        ? { added: [], removed: [], changed: [] }
        : diffOpenApiSpecs(row.openapi_spec, openapiSpec);
      const shouldRecordVersion = isInitial || !isEmptyDiff(diff);
      log.ok("diff_openapi", {
        isInitial,
        shouldRecordVersion,
        added: diff.added.length,
        removed: diff.removed.length,
        changed: diff.changed.length,
      });

      if (shouldRecordVersion) {
        await client.query(
          `INSERT INTO api_docs.service_versions
             (service_id, openapi_spec, diff_summary, is_initial)
           VALUES ($1, $2, $3, $4)`,
          [
            row.id,
            JSON.stringify(openapiSpec),
            JSON.stringify(diff),
            isInitial,
          ]
        );
        log.ok("db_insert_version", { isInitial });
      } else {
        log.ok("db_insert_version_skipped", { reason: "empty_diff" });
      }
    }

    await client.query("COMMIT");
    log.ok("db_commit");
    log.done(200, { serviceId: service.id, slug: service.slug });
    return withRequestId(NextResponse.json({ service }), log.reqId);
  } catch (err: unknown) {
    await client.query("ROLLBACK").catch(() => {});
    if (isPgUniqueViolation(err)) {
      return failResponse(
        log,
        "db_update",
        err,
        NextResponse.json(
          {
            error: `service with slug "${slug}" already exists for this brand`,
          },
          { status: 409 }
        ),
        snap()
      );
    }
    return failResponse(
      log,
      "db_update",
      err,
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      snap()
    );
  } finally {
    client.release();
  }
}
