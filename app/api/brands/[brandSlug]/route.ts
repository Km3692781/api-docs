import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  isPgUniqueViolation,
  parseLogoFile,
  parseThemeField,
  validateSlug,
} from "@/lib/form-validators";
import {
  createApiLogger,
  failResponse,
  snapshotRequest,
  withRequestId,
} from "@/lib/api-logger";

/** DELETE /api/brands/:brandSlug — cascades services, versions, clients */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ brandSlug: string }> }
) {
  const { brandSlug } = await params;
  const log = createApiLogger("DELETE /api/brands/[brandSlug]", req, {
    brandSlug,
  });
  log.ok("start", { brandSlug });

  const snap = () => snapshotRequest(req, { params: { brandSlug } });

  try {
    const result = await pool.query(
      `DELETE FROM api_docs.brands
       WHERE slug = $1
       RETURNING id, slug, name`,
      [brandSlug]
    );

    if (result.rowCount === 0) {
      return failResponse(
        log,
        "db_delete",
        new Error(`brand "${brandSlug}" not found`),
        NextResponse.json(
          { error: `brand "${brandSlug}" not found` },
          { status: 404 }
        ),
        snap()
      );
    }

    const brand = result.rows[0];
    log.ok("db_delete", { brandId: brand.id, slug: brand.slug });
    log.done(200, { brandId: brand.id });
    return withRequestId(
      NextResponse.json({ ok: true, brand }),
      log.reqId
    );
  } catch (err) {
    return failResponse(
      log,
      "db_delete",
      err,
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      snap()
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ brandSlug: string }> }
) {
  const { brandSlug } = await params;
  const log = createApiLogger("PATCH /api/brands/[brandSlug]", req, {
    brandSlug,
  });
  log.ok("start", { brandSlug });

  let formData: FormData;
  try {
    formData = await req.formData();
    log.ok("parse_form");
  } catch (err) {
    return failResponse(
      log,
      "parse_form",
      err instanceof Error ? err : new Error("Request must be multipart/form-data"),
      NextResponse.json(
        { error: "Request must be multipart/form-data" },
        { status: 400 }
      ),
      snapshotRequest(req, { params: { brandSlug } })
    );
  }

  const snap = () => snapshotRequest(req, { params: { brandSlug }, formData });

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
    return failResponse(
      log,
      "validate_fields",
      new Error(
        'Provide at least one of: name, slug, logo, theme, or clear_logo="true"'
      ),
      NextResponse.json(
        {
          error:
            'Provide at least one of: name, slug, logo, theme, or clear_logo="true"',
        },
        { status: 400 }
      ),
      snap()
    );
  }

  if (hasSlug) {
    const slugErr = validateSlug(slug as string, { reserved: true });
    if (slugErr) {
      return failResponse(
        log,
        "validate_slug",
        new Error(slugErr),
        NextResponse.json({ error: slugErr }, { status: 400 }),
        snap()
      );
    }
  }
  log.ok("validate_fields", { hasName, hasSlug, hasTheme, hasLogo, wantsClearLogo });

  let theme: { primary?: string; accent?: string } | undefined;
  if (hasTheme) {
    const parsed = parseThemeField(themeRaw);
    if (parsed instanceof NextResponse) {
      return failResponse(log, "parse_theme", new Error("invalid theme"), parsed, snap());
    }
    theme = parsed;
    log.ok("parse_theme");
  }

  let logo_base64: string | null | undefined;
  if (wantsClearLogo) {
    logo_base64 = null;
    log.ok("parse_logo", { clearLogo: true });
  } else if (hasLogo) {
    const parsed = await parseLogoFile(logoFile);
    if (parsed instanceof NextResponse) {
      return failResponse(log, "parse_logo", new Error("invalid logo"), parsed, snap());
    }
    logo_base64 = parsed;
    log.ok("parse_logo", { hasLogo: true });
  }

  const existing = await pool.query(
    `SELECT id, slug, name, theme, logo_base64, created_at
     FROM api_docs.brands WHERE slug = $1`,
    [brandSlug]
  );

  if (existing.rowCount === 0) {
    return failResponse(
      log,
      "resolve_brand",
      new Error(`brand "${brandSlug}" not found`),
      NextResponse.json(
        { error: `brand "${brandSlug}" not found` },
        { status: 404 }
      ),
      snap()
    );
  }
  log.ok("resolve_brand", { brandId: existing.rows[0].id });

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
    log.ok("db_update", { brandId: result.rows[0]?.id, slug: result.rows[0]?.slug });
    log.done(200, { brandId: result.rows[0]?.id });
    return withRequestId(
      NextResponse.json({ brand: result.rows[0] }),
      log.reqId
    );
  } catch (err: unknown) {
    if (isPgUniqueViolation(err)) {
      return failResponse(
        log,
        "db_update",
        err,
        NextResponse.json(
          { error: `brand with slug "${slug}" already exists` },
          { status: 409 }
        ),
        snap()
      );
    }
    return failResponse(
      log,
      "db_update",
      err,
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      snap()
    );
  }
}
