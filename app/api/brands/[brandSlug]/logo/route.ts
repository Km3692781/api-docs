import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const ICON_SIZE = 64;

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

  // Favicon / tab icon: wrap in a fixed-size SVG so tiny uploads still fill the icon.
  if (variant === "icon") {
    const escaped = dataUri
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
  <image width="${ICON_SIZE}" height="${ICON_SIZE}" preserveAspectRatio="xMidYMid meet" href="${escaped}"/>
</svg>`;

    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

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
