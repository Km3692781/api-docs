import { NextResponse } from "next/server";

/**
 * Unscoped collection download is disabled.
 * Use /api/brands/.../services/.../clients/{clientId}/download
 */
export async function GET() {
  return NextResponse.json(
    {
      error:
        "Collection download requires a client access id. Use /api/brands/{brand}/services/{service}/clients/{clientId}/download",
    },
    { status: 404 }
  );
}
