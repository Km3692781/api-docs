import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ brandSlug: string }> }
) {
  const { brandSlug } = await params;

  const result = await pool.query(
    `SELECT logo_base64 FROM api_docs.brands WHERE slug = $1`,
    [brandSlug]
  );

  if (result.rowCount === 0 || !result.rows[0].logo_base64) {
    return new NextResponse(null, { status: 404 });
  }

  const dataUri: string = result.rows[0].logo_base64;

  // dataUri is like: data:image/png;base64,XXXX
  const [meta, base64Data] = dataUri.split(",");
  const mimeType = meta.split(":")[1].split(";")[0];
  const buffer = Buffer.from(base64Data, "base64");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}