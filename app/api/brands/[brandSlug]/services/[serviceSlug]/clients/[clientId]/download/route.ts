import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import type { PostmanCollection } from "@/lib/postman-types";
import {
  filterCollectionByAllowlist,
  isUuid,
  parseFolderAllowlist,
} from "@/lib/folder-access";
import {
  createApiLogger,
  failResponse,
  snapshotRequest,
  withRequestId,
} from "@/lib/api-logger";

/** GET filtered Postman collection for a docs client access link */
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
    "GET /api/brands/[brandSlug]/services/[serviceSlug]/clients/[clientId]/download",
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
      new Error("Collection not found"),
      NextResponse.json({ error: "Collection not found" }, { status: 404 }),
      snap()
    );
  }
  log.ok("validate_client_id");

  try {
    const result = await pool.query(
      `SELECT s.name AS service_name, s.source_collection, c.folder_allowlist
       FROM api_docs.doc_clients c
       JOIN api_docs.services s ON s.id = c.service_id
       JOIN api_docs.brands b ON b.id = c.brand_id
       WHERE b.slug = $1 AND s.slug = $2 AND c.id = $3`,
      [brandSlug, serviceSlug, clientId]
    );

    if (result.rowCount === 0 || !result.rows[0].source_collection) {
      return failResponse(
        log,
        "resolve_client_collection",
        new Error("Collection not found"),
        NextResponse.json({ error: "Collection not found" }, { status: 404 }),
        snap()
      );
    }
    log.ok("resolve_client_collection", {
      serviceName: result.rows[0].service_name,
    });

    const allowlist = parseFolderAllowlist(result.rows[0].folder_allowlist);
    const collection = filterCollectionByAllowlist(
      result.rows[0].source_collection as PostmanCollection,
      allowlist
    );
    log.ok("filter_collection", {
      allowlistSize: allowlist.length,
      itemCount: Array.isArray(collection.item) ? collection.item.length : 0,
    });

    const serviceName: string = result.rows[0].service_name ?? serviceSlug;
    const safeName = serviceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const filename = `${safeName || serviceSlug}.postman_collection.json`;

    const body = JSON.stringify(collection, null, 2);

    log.done(200, { filename, bytes: body.length });
    return withRequestId(
      new NextResponse(body, {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      }),
      log.reqId
    );
  } catch (err) {
    return failResponse(
      log,
      "download_collection",
      err,
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      snap()
    );
  }
}
