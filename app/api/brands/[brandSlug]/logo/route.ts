import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  makeLogoIcon,
  parseDataUri,
  trimLogoBuffer,
} from "@/lib/logo-process";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ brandSlug: string }> }
) {
  const { brandSlug } = await params;
  const variant = req.nextUrl.searchParams.get("variant");

  const result = await pool.query(
    `SELECT logo_base64 FROM api_docs.brands WHERE slug = $1`,
    [brandSlug]
  );

  if (result.rowCount === 0 || !result.rows[0].logo_base64) {
    return new NextResponse(null, { status: 404 });
  }

  const dataUri: string = result.rows[0].logo_base64;
  const parsed = parseDataUri(dataUri);
  if (!parsed) {
    return new NextResponse(null, { status: 500 });
  }

  // Trim padding on the fly so already-uploaded logos (with empty canvas
  // space) still fill the sidebar / favicon without a re-upload.
  const processed =
    variant === "icon"
      ? await makeLogoIcon(parsed.buffer, parsed.mimeType, 64)
      : await trimLogoBuffer(parsed.buffer, parsed.mimeType);

  return new NextResponse(new Uint8Array(processed.buffer), {
    headers: {
      "Content-Type": processed.mimeType,
      // Short cache: processing is cheap and logo updates should show quickly
      "Cache-Control": "public, max-age=300",
    },
  });
}
