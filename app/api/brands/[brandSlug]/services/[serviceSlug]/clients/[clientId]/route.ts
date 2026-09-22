import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  isUuid,
  normalizeAllowlistForStorage,
} from "@/lib/folder-access";

async function resolveClient(
  brandSlug: string,
  serviceSlug: string,
  clientId: string
) {
  if (!isUuid(clientId)) return null;
  const result = await pool.query(
    `SELECT c.id, c.name, c.folder_allowlist, c.brand_id, c.service_id,
            c.created_at, c.updated_at
     FROM api_docs.doc_clients c
     JOIN api_docs.services s ON s.id = c.service_id
     JOIN api_docs.brands b ON b.id = c.brand_id
     WHERE b.slug = $1 AND s.slug = $2 AND c.id = $3`,
    [brandSlug, serviceSlug, clientId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
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

/** PATCH /api/brands/:brand/services/:service/clients/:clientId */
export async function PATCH(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      brandSlug: string;
      serviceSlug: string;
      clientId: string;
    }>;
  }
) {
  const { brandSlug, serviceSlug, clientId } = await params;
  const existing = await resolveClient(brandSlug, serviceSlug, clientId);
  if (!existing) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
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
  const hasName = typeof obj.name === "string";
  const hasAllowlist = obj.folder_allowlist !== undefined;

  if (!hasName && !hasAllowlist) {
    return NextResponse.json(
      { error: "Provide name and/or folder_allowlist" },
      { status: 400 }
    );
  }

  if (hasName && !(obj.name as string).trim()) {
    return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
  }

  let allowlistJson: string | undefined;
  if (hasAllowlist) {
    const normalized = normalizeAllowlistForStorage(obj.folder_allowlist);
    if ("error" in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    allowlistJson = JSON.stringify(normalized);
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (hasName) {
    sets.push(`name = $${i++}`);
    values.push((obj.name as string).trim());
  }
  if (allowlistJson !== undefined) {
    sets.push(`folder_allowlist = $${i++}`);
    values.push(allowlistJson);
  }
  values.push(clientId);

  try {
    const result = await pool.query(
      `UPDATE api_docs.doc_clients
       SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING id, name, folder_allowlist, brand_id, service_id, created_at, updated_at`,
      values
    );

    return NextResponse.json({
      client: mapClientRow(result.rows[0]),
      docs_url: `/${brandSlug}/${serviceSlug}/${clientId}`,
    });
  } catch (err) {
    console.error("Update doc_client error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE */
export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      brandSlug: string;
      serviceSlug: string;
      clientId: string;
    }>;
  }
) {
  const { brandSlug, serviceSlug, clientId } = await params;
  if (!isUuid(clientId)) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const result = await pool.query(
    `DELETE FROM api_docs.doc_clients c
     USING api_docs.services s, api_docs.brands b
     WHERE c.id = $3
       AND c.service_id = s.id
       AND c.brand_id = b.id
       AND b.slug = $1
       AND s.slug = $2
     RETURNING c.id`,
    [brandSlug, serviceSlug, clientId]
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: result.rows[0].id });
}

/** GET one client */
export async function GET(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      brandSlug: string;
      serviceSlug: string;
      clientId: string;
    }>;
  }
) {
  const { brandSlug, serviceSlug, clientId } = await params;
  const existing = await resolveClient(brandSlug, serviceSlug, clientId);
  if (!existing) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  return NextResponse.json({
    client: mapClientRow(existing),
    docs_url: `/${brandSlug}/${serviceSlug}/${clientId}`,
  });
}
