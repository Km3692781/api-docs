import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { normalizeAllowlistForStorage } from "@/lib/folder-access";

async function resolveService(brandSlug: string, serviceSlug: string) {
  const result = await pool.query(
    `SELECT s.id AS service_id, b.id AS brand_id
     FROM api_docs.services s
     JOIN api_docs.brands b ON b.id = s.brand_id
     WHERE b.slug = $1 AND s.slug = $2`,
    [brandSlug, serviceSlug]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0] as { service_id: string; brand_id: string };
}

function mapClientRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    folder_allowlist: row.folder_allowlist ?? [],
    brand_id: row.brand_id,
    service_id: row.service_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** GET /api/brands/:brand/services/:service/clients — list clients */
export async function GET(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ brandSlug: string; serviceSlug: string }> }
) {
  const { brandSlug, serviceSlug } = await params;
  const service = await resolveService(brandSlug, serviceSlug);
  if (!service) {
    return NextResponse.json(
      { error: `service "${serviceSlug}" not found for brand "${brandSlug}"` },
      { status: 404 }
    );
  }

  const result = await pool.query(
    `SELECT id, name, folder_allowlist, brand_id, service_id, created_at, updated_at
     FROM api_docs.doc_clients
     WHERE service_id = $1
     ORDER BY created_at ASC`,
    [service.service_id]
  );

  return NextResponse.json({ clients: result.rows.map(mapClientRow) });
}

/** POST — create client */
export async function POST(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ brandSlug: string; serviceSlug: string }> }
) {
  const { brandSlug, serviceSlug } = await params;
  const service = await resolveService(brandSlug, serviceSlug);
  if (!service) {
    return NextResponse.json(
      { error: `service "${serviceSlug}" not found for brand "${brandSlug}"` },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const obj = body as Record<string, unknown>;
  const name = obj.name;
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const allowlistResult = normalizeAllowlistForStorage(
    obj.folder_allowlist !== undefined ? obj.folder_allowlist : []
  );
  if ("error" in allowlistResult) {
    return NextResponse.json({ error: allowlistResult.error }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `INSERT INTO api_docs.doc_clients (brand_id, service_id, name, folder_allowlist)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, folder_allowlist, brand_id, service_id, created_at, updated_at`,
      [
        service.brand_id,
        service.service_id,
        name.trim(),
        JSON.stringify(allowlistResult),
      ]
    );

    const client = mapClientRow(result.rows[0]);
    return NextResponse.json(
      {
        client,
        docs_url: `/${brandSlug}/${serviceSlug}/${client.id}`,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Create doc_client error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
