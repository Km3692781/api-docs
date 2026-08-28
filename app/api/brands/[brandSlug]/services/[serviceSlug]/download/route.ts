import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ brandSlug: string; serviceSlug: string }> }
) {
  const { brandSlug, serviceSlug } = await params;

  const result = await pool.query(
    `SELECT s.name AS service_name, s.source_collection
     FROM api_docs.services s
     JOIN api_docs.brands b ON b.id = s.brand_id
     WHERE b.slug = $1 AND s.slug = $2`,
    [brandSlug, serviceSlug]
  );

  if (result.rowCount === 0 || !result.rows[0].source_collection) {
    return NextResponse.json(
      { error: "Collection not found" },
      { status: 404 }
    );
  }

  const collection = result.rows[0].source_collection;
  const serviceName: string = result.rows[0].service_name ?? serviceSlug;

  // Build a safe filename
  const safeName = serviceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const filename = `${safeName || serviceSlug}.postman_collection.json`;

  const body = JSON.stringify(collection, null, 2);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}