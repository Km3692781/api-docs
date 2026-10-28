import { NextRequest, NextResponse } from "next/server";
import {
  createApiLogger,
  failResponse,
  snapshotRequest,
} from "@/lib/api-logger";

/**
 * Unscoped collection download is disabled.
 * Use /api/brands/.../services/.../clients/{clientId}/download
 */
export async function GET(req: NextRequest) {
  const log = createApiLogger(
    "GET /api/brands/[brandSlug]/services/[serviceSlug]/download",
    req
  );
  log.ok("start");
  return failResponse(
    log,
    "require_client",
    new Error(
      "Collection download requires a client access id. Use /api/brands/{brand}/services/{service}/clients/{clientId}/download"
    ),
    NextResponse.json(
      {
        error:
          "Collection download requires a client access id. Use /api/brands/{brand}/services/{service}/clients/{clientId}/download",
      },
      { status: 404 }
    ),
    snapshotRequest(req)
  );
}
