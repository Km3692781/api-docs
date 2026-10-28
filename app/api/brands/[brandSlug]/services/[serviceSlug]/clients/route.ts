import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { normalizeAllowlistForStorage } from "@/lib/folder-access";
import {
  createApiLogger,
  failResponse,
  snapshotRequest,
  withRequestId,
} from "@/lib/api-logger";

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

function mapClientRow(
  row: Record<string, unknown>,
  brandSlug: string,
  serviceSlug: string
) {
  return {
    id: row.id,
    name: row.name,
    folder_allowlist: row.folder_allowlist ?? [],
    brand_id: row.brand_id,
    service_id: row.service_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    docs_url: `/${brandSlug}/${serviceSlug}/${row.id}`,
  };
}

/** GET /api/brands/:brand/services/:service/clients — list clients */
export async function GET(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ brandSlug: string; serviceSlug: string }> }
) {
  const { brandSlug, serviceSlug } = await params;
  const log = createApiLogger(
    "GET /api/brands/[brandSlug]/services/[serviceSlug]/clients",
    req,
    { brandSlug, serviceSlug }
  );
  log.ok("start", { brandSlug, serviceSlug });

  const snap = () =>
    snapshotRequest(req, { params: { brandSlug, serviceSlug } });

  const service = await resolveService(brandSlug, serviceSlug);
  if (!service) {
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
  log.ok("resolve_service", { serviceId: service.service_id });

  try {
    const result = await pool.query(
      `SELECT id, name, folder_allowlist, brand_id, service_id, created_at, updated_at
       FROM api_docs.doc_clients
       WHERE service_id = $1
       ORDER BY created_at ASC`,
      [service.service_id]
    );
    log.ok("db_list", { count: result.rowCount ?? 0 });
    log.done(200, { count: result.rowCount ?? 0 });
    return withRequestId(
      NextResponse.json({
        clients: result.rows.map((row) =>
          mapClientRow(row, brandSlug, serviceSlug)
        ),
      }),
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

/** POST — create client */
export async function POST(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ brandSlug: string; serviceSlug: string }> }
) {
  const { brandSlug, serviceSlug } = await params;
  const log = createApiLogger(
    "POST /api/brands/[brandSlug]/services/[serviceSlug]/clients",
    req,
    { brandSlug, serviceSlug }
  );
  log.ok("start", { brandSlug, serviceSlug });

  const service = await resolveService(brandSlug, serviceSlug);
  if (!service) {
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
      snapshotRequest(req, { params: { brandSlug, serviceSlug } })
    );
  }
  log.ok("resolve_service", { serviceId: service.service_id });

  let body: unknown;
  try {
    body = await req.json();
    log.ok("parse_json");
  } catch (err) {
    return failResponse(
      log,
      "parse_json",
      err instanceof Error ? err : new Error("JSON body required"),
      NextResponse.json({ error: "JSON body required" }, { status: 400 }),
      snapshotRequest(req, { params: { brandSlug, serviceSlug } })
    );
  }

  const snap = () =>
    snapshotRequest(req, {
      params: { brandSlug, serviceSlug },
      jsonBody: body,
    });

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return failResponse(
      log,
      "validate_fields",
      new Error("Body must be a JSON object"),
      NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 }),
      snap()
    );
  }

  const obj = body as Record<string, unknown>;
  const name = obj.name;
  if (!name || typeof name !== "string" || !name.trim()) {
    return failResponse(
      log,
      "validate_fields",
      new Error("name is required"),
      NextResponse.json({ error: "name is required" }, { status: 400 }),
      snap()
    );
  }

  const allowlistResult = normalizeAllowlistForStorage(
    obj.folder_allowlist !== undefined ? obj.folder_allowlist : []
  );
  if ("error" in allowlistResult) {
    return failResponse(
      log,
      "validate_allowlist",
      new Error(allowlistResult.error),
      NextResponse.json({ error: allowlistResult.error }, { status: 400 }),
      snap()
    );
  }
  log.ok("validate_fields", {
    name: name.trim(),
    allowlistSize: allowlistResult.length,
  });

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

    const client = mapClientRow(result.rows[0], brandSlug, serviceSlug);
    log.ok("db_insert", { clientId: client.id });
    log.done(201, { clientId: client.id });
    return withRequestId(
      NextResponse.json({ client }, { status: 201 }),
      log.reqId
    );
  } catch (err) {
    return failResponse(
      log,
      "db_insert",
      err,
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      snap()
    );
  }
}
