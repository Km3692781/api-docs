import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  isPgUniqueViolation,
  parseLogoFile,
  parseThemeField,
  validateSlug,
} from "@/lib/form-validators";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ brandSlug: string }> }
) {
  const { brandSlug } = await params;

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
  const clearLogo = formData.get("clear_logo");

  const hasName = typeof name === "string" && name.length > 0;
  const hasSlug = typeof slug === "string" && slug.length > 0;
  const hasTheme =
    themeRaw !== null && themeRaw !== undefined && themeRaw !== "";
  const hasLogo = logoFile instanceof File && logoFile.size > 0;
  const wantsClearLogo =
    clearLogo === "true" || clearLogo === "1" || clearLogo === "yes";

  if (!hasName && !hasSlug && !hasTheme && !hasLogo && !wantsClearLogo) {
    return NextResponse.json(
      {
        error:
          'Provide at least one of: name, slug, logo, theme, or clear_logo="true"',
      },
      { status: 400 }
    );
  }

  if (hasSlug) {
    const slugErr = validateSlug(slug as string, { reserved: true });
    if (slugErr) {
      return NextResponse.json({ error: slugErr }, { status: 400 });
    }
  }

  let theme: { primary?: string; accent?: string } | undefined;
  if (hasTheme) {
    const parsed = parseThemeField(themeRaw);
    if (parsed instanceof NextResponse) return parsed;
    theme = parsed;
  }

  let logo_base64: string | null | undefined;
  if (wantsClearLogo) {
    logo_base64 = null;
  } else if (hasLogo) {
    const parsed = await parseLogoFile(logoFile);
    if (parsed instanceof NextResponse) return parsed;
    logo_base64 = parsed;
  }

  const existing = await pool.query(
    `SELECT id, slug, name, theme, logo_base64, created_at
     FROM api_docs.brands WHERE slug = $1`,
    [brandSlug]
  );

  if (existing.rowCount === 0) {
    return NextResponse.json(
      { error: `brand "${brandSlug}" not found` },
      { status: 404 }
    );
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (hasName) {
    sets.push(`name = $${i++}`);
    values.push(name);
  }
  if (hasSlug) {
    sets.push(`slug = $${i++}`);
    values.push(slug);
  }
  if (theme !== undefined) {
    sets.push(`theme = $${i++}`);
    values.push(JSON.stringify(theme));
  }
  if (logo_base64 !== undefined) {
    sets.push(`logo_base64 = $${i++}`);
    values.push(logo_base64);
  }

  values.push(brandSlug);

  try {
    const result = await pool.query(
      `UPDATE api_docs.brands
       SET ${sets.join(", ")}
       WHERE slug = $${i}
       RETURNING id, slug, name, theme, created_at,
         (logo_base64 IS NOT NULL) AS has_logo`,
      values
    );

    return NextResponse.json({ brand: result.rows[0] });
  } catch (err: unknown) {
    if (isPgUniqueViolation(err)) {
      return NextResponse.json(
        { error: `brand with slug "${slug}" already exists` },
        { status: 409 }
      );
    }
    console.error("Update brand error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
