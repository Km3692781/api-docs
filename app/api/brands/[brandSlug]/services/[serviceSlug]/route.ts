import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { convertPostmanToOpenApi } from "@/lib/converter";
import { diffOpenApiSpecs, isEmptyDiff } from "@/lib/openapi-diff";
import { isPgUniqueViolation, validateSlug } from "@/lib/form-validators";

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

export async function PATCH(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ brandSlug: string; serviceSlug: string }> }
) {
  const { brandSlug, serviceSlug } = await params;

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

  const hasName = typeof name === "string" && name.length > 0;
  const hasSlug = typeof slug === "string" && slug.length > 0;
  const hasCollection = file instanceof File && file.size > 0;

  if (!hasName && !hasSlug && !hasCollection) {
    return NextResponse.json(
      { error: "Provide at least one of: name, slug, collection" },
      { status: 400 }
    );
  }

  if (hasSlug) {
    const slugErr = validateSlug(slug as string);
    if (slugErr) {
      return NextResponse.json({ error: slugErr }, { status: 400 });
    }
  }

  let postmanCollection: object | undefined;
  let openapiSpec: object | undefined;

  if (hasCollection) {
    if (!(file as File).name.endsWith(".json")) {
      return NextResponse.json(
        { error: "collection must be a .json file" },
        { status: 400 }
      );
    }
    try {
      const text = await (file as File).text();
      postmanCollection = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "collection file is not valid JSON" },
        { status: 400 }
      );
    }

    try {
      openapiSpec = await convertPostmanToOpenApi(postmanCollection!);
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
  }

  const client = await pool.connect();
  try {
    await ensureVersionsTable();
    await client.query("BEGIN");

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
      return NextResponse.json(
        {
          error: `service "${serviceSlug}" not found for brand "${brandSlug}"`,
        },
        { status: 404 }
      );
    }

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
      }
    }

    await client.query("COMMIT");
    return NextResponse.json({ service });
  } catch (err: unknown) {
    await client.query("ROLLBACK").catch(() => {});
    if (isPgUniqueViolation(err)) {
      return NextResponse.json(
        {
          error: `service with slug "${slug}" already exists for this brand`,
        },
        { status: 409 }
      );
    }
    console.error("Update service error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
