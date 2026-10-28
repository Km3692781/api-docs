import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  isUuid,
  normalizeAllowlistForStorage,
} from "@/lib/folder-access";
import {
  createApiLogger,
  failResponse,
  snapshotRequest,
  withRequestId,
} from "@/lib/api-logger";

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
  const log = createApiLogger(
    "PATCH /api/brands/[brandSlug]/services/[serviceSlug]/clients/[clientId]",
    req,
    { brandSlug, serviceSlug, clientId }
  );
  log.ok("start", { brandSlug, serviceSlug, clientId });

  const existing = await resolveClient(brandSlug, serviceSlug, clientId);
  if (!existing) {
    return failResponse(
      log,
      "resolve_client",
      new Error("Client not found"),
      NextResponse.json({ error: "Client not found" }, { status: 404 }),
      snapshotRequest(req, {
        params: { brandSlug, serviceSlug, clientId },
      })
    );
  }
  log.ok("resolve_client", { clientId: existing.id });

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
      snapshotRequest(req, {
        params: { brandSlug, serviceSlug, clientId },
      })
    );
  }

  const snap = () =>
    snapshotRequest(req, {
      params: { brandSlug, serviceSlug, clientId },
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
  const hasName = typeof obj.name === "string";
  const hasAllowlist = obj.folder_allowlist !== undefined;

  if (!hasName && !hasAllowlist) {
    return failResponse(
      log,
      "validate_fields",
      new Error("Provide name and/or folder_allowlist"),
      NextResponse.json(
        { error: "Provide name and/or folder_allowlist" },
        { status: 400 }
      ),
      snap()
    );
  }

  if (hasName && !(obj.name as string).trim()) {
    return failResponse(
      log,
      "validate_fields",
      new Error("name cannot be empty"),
      NextResponse.json({ error: "name cannot be empty" }, { status: 400 }),
      snap()
    );
  }

  let allowlistJson: string | undefined;
  if (hasAllowlist) {
    const normalized = normalizeAllowlistForStorage(obj.folder_allowlist);
    if ("error" in normalized) {
      return failResponse(
        log,
        "validate_allowlist",
        new Error(normalized.error),
        NextResponse.json({ error: normalized.error }, { status: 400 }),
        snap()
      );
    }
    allowlistJson = JSON.stringify(normalized);
  }
  log.ok("validate_fields", { hasName, hasAllowlist });

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

    log.ok("db_update", { clientId });
    log.done(200, { clientId });
    return withRequestId(
      NextResponse.json({
        client: mapClientRow(result.rows[0], brandSlug, serviceSlug),
      }),
      log.reqId
    );
  } catch (err) {
    return failResponse(
      log,
      "db_update",
      err,
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      snap()
    );
  }
}

/** DELETE */
export async function DELETE(
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
  const log = createApiLogger(
    "DELETE /api/brands/[brandSlug]/services/[serviceSlug]/clients/[clientId]",
    req,
    { brandSlug, serviceSlug, clientId }
  );
  log.ok("start", { brandSlug, serviceSlug, clientId });

  const snap = () =>
    snapshotRequest(req, {
      params: { brandSlug, serviceSlug, clientId },
    });

  if (!isUuid(clientId)) {
    return failResponse(
      log,
      "validate_client_id",
      new Error("Client not found"),
      NextResponse.json({ error: "Client not found" }, { status: 404 }),
      snap()
    );
  }
  log.ok("validate_client_id");

  try {
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
      return failResponse(
        log,
        "db_delete",
        new Error("Client not found"),
        NextResponse.json({ error: "Client not found" }, { status: 404 }),
        snap()
      );
    }

    log.ok("db_delete", { clientId: result.rows[0].id });
    log.done(200, { clientId: result.rows[0].id });
    return withRequestId(
      NextResponse.json({ ok: true, id: result.rows[0].id }),
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

/** GET one client */
export async function GET(
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
  const log = createApiLogger(
    "GET /api/brands/[brandSlug]/services/[serviceSlug]/clients/[clientId]",
    req,
    { brandSlug, serviceSlug, clientId }
  );
  log.ok("start", { brandSlug, serviceSlug, clientId });

  const existing = await resolveClient(brandSlug, serviceSlug, clientId);
  if (!existing) {
    return failResponse(
      log,
      "resolve_client",
      new Error("Client not found"),
      NextResponse.json({ error: "Client not found" }, { status: 404 }),
      snapshotRequest(req, {
        params: { brandSlug, serviceSlug, clientId },
      })
    );
  }
  log.ok("resolve_client", { clientId: existing.id });
  log.done(200, { clientId: existing.id });
  return withRequestId(
    NextResponse.json({
      client: mapClientRow(existing, brandSlug, serviceSlug),
    }),
    log.reqId
  );
}
