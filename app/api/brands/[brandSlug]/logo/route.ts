import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  makeLogoIcon,
  parseDataUri,
  trimLogoBuffer,
} from "@/lib/logo-process";
import {
  createApiLogger,
  failResponse,
  snapshotRequest,
  withRequestId,
} from "@/lib/api-logger";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ brandSlug: string }> }
) {
  const { brandSlug } = await params;
  const variant = req.nextUrl.searchParams.get("variant");
  const log = createApiLogger("GET /api/brands/[brandSlug]/logo", req, {
    brandSlug,
  });
  log.ok("start", { brandSlug, variant });

  const snap = () => snapshotRequest(req, { params: { brandSlug } });

  try {
    const result = await pool.query(
      `SELECT logo_base64 FROM api_docs.brands WHERE slug = $1`,
      [brandSlug]
    );

    if (result.rowCount === 0 || !result.rows[0].logo_base64) {
      return failResponse(
        log,
        "resolve_logo",
        new Error("logo not found"),
        new NextResponse(null, { status: 404 }),
        snap()
      );
    }
    log.ok("resolve_logo");

    const dataUri: string = result.rows[0].logo_base64;
    const parsed = parseDataUri(dataUri);
    if (!parsed) {
      return failResponse(
        log,
        "parse_data_uri",
        new Error("Stored logo is invalid"),
        NextResponse.json(
          { error: "Stored logo is invalid" },
          { status: 500 }
        ),
        snap()
      );
    }
    log.ok("parse_data_uri", { mimeType: parsed.mimeType });

    // Trim padding on the fly so already-uploaded logos (with empty canvas
    // space) still fill the sidebar / favicon without a re-upload.
    // If sharp fails on the host, these helpers return the original bytes.
    const processed =
      variant === "icon"
        ? await makeLogoIcon(parsed.buffer, parsed.mimeType, 64)
        : await trimLogoBuffer(parsed.buffer, parsed.mimeType);
    log.ok("process_logo", {
      variant: variant === "icon" ? "icon" : "trim",
      mimeType: processed.mimeType,
      bytes: processed.buffer.length,
    });

    log.done(200, { brandSlug, variant });
    return withRequestId(
      new NextResponse(new Uint8Array(processed.buffer), {
        headers: {
          "Content-Type": processed.mimeType,
          "Cache-Control": "public, max-age=300",
        },
      }),
      log.reqId
    );
  } catch (err) {
    return failResponse(
      log,
      "process_logo",
      err,
      NextResponse.json({ error: "Failed to load logo" }, { status: 500 }),
      snap()
    );
  }
}
