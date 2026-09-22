import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { listFolderTree } from "@/lib/folder-access";
import type { PostmanCollection } from "@/lib/postman-types";

/**
 * GET /api/folder-slugs
 * Nested folder tree (up to 3 levels) for every brand/service.
 * Use each node's `path` in doc_clients.folder_allowlist
 * (e.g. "onboarding", "a/c/h", "a/c/all").
 */
export async function GET() {
  try {
    const result = await pool.query(
      `SELECT
         b.slug  AS brand_slug,
         b.name  AS brand_name,
         s.slug  AS service_slug,
         s.name  AS service_name,
         s.source_collection AS source_collection
       FROM api_docs.brands b
       JOIN api_docs.services s ON s.brand_id = b.id
       ORDER BY b.name ASC, s.name ASC`
    );

    type BrandBucket = {
      slug: string;
      name: string;
      services: Array<{
        slug: string;
        name: string;
        folders: ReturnType<typeof listFolderTree>;
      }>;
    };

    const byBrand = new Map<string, BrandBucket>();

    for (const row of result.rows) {
      let brand = byBrand.get(row.brand_slug);
      if (!brand) {
        brand = {
          slug: row.brand_slug,
          name: row.brand_name,
          services: [],
        };
        byBrand.set(row.brand_slug, brand);
      }

      brand.services.push({
        slug: row.service_slug,
        name: row.service_name,
        folders: listFolderTree(
          row.source_collection as PostmanCollection | null
        ),
      });
    }

    return NextResponse.json({
      brands: [...byBrand.values()],
      meta: {
        max_depth: 3,
        allowlist_notes: [
          '[] or ["all"] = entire collection',
          '"a" = folder A and everything under it',
          '"a/c/h" = folder H under A/C (and deeper content)',
          '"a/c/all" = every direct child of C under A',
        ],
      },
    });
  } catch (err) {
    console.error("List folder slugs error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
