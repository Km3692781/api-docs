import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  isPgUniqueViolation,
  parseLogoFile,
  parseThemeField,
  validateSlug,
} from "@/lib/form-validators";

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data" },
      { status: 400 }
    );
  }

  const name = formData.get("name");
  const slug = formData.get("slug");
  const logoFile = formData.get("logo");
  const themeRaw = formData.get("theme");

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (!slug || typeof slug !== "string") {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const slugErr = validateSlug(slug, { reserved: true });
  if (slugErr) {
    return NextResponse.json({ error: slugErr }, { status: 400 });
  }

  const themeResult = parseThemeField(themeRaw);
  if (themeResult instanceof NextResponse) return themeResult;
  const theme = themeResult;

  const logoResult = await parseLogoFile(logoFile);
  if (logoResult instanceof NextResponse) return logoResult;
  const logo_base64 = logoResult;

  try {
    const result = await pool.query(
      `INSERT INTO api_docs.brands (slug, name, logo_base64, theme)
       VALUES ($1, $2, $3, $4)
       RETURNING id, slug, name, theme, created_at`,
      [slug, name, logo_base64, JSON.stringify(theme)]
    );

    return NextResponse.json({ brand: result.rows[0] }, { status: 201 });
  } catch (err: unknown) {
    if (isPgUniqueViolation(err)) {
      return NextResponse.json(
        { error: `brand with slug "${slug}" already exists` },
        { status: 409 }
      );
    }
    console.error("Create brand error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
