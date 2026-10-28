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

/** GET /api/brands — list all brands */
export async function GET(req: NextRequest) {
  const log = createApiLogger("GET /api/brands", req);
  log.ok("start");

  try {
    const result = await pool.query(
      `SELECT id, slug, name, theme, created_at,
              (logo_base64 IS NOT NULL) AS has_logo
       FROM api_docs.brands
       ORDER BY name ASC`
    );
    log.ok("db_list", { count: result.rowCount ?? 0 });
    log.done(200, { count: result.rowCount ?? 0 });
    return withRequestId(
      NextResponse.json({ brands: result.rows }),
      log.reqId
    );
  } catch (err) {
    return failResponse(
      log,
      "db_list",
      err,
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      snapshotRequest(req)
    );
  }
}

export async function POST(req: NextRequest) {
  const log = createApiLogger("POST /api/brands", req);
  log.ok("start");

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
      snapshotRequest(req)
    );
  }

  const snap = () => snapshotRequest(req, { formData });

  const name = formData.get("name");
  const slug = formData.get("slug");
  const logoFile = formData.get("logo");
  const themeRaw = formData.get("theme");

  if (!name || typeof name !== "string") {
    return failResponse(
      log,
      "validate_fields",
      new Error("name is required"),
      NextResponse.json({ error: "name is required" }, { status: 400 }),
      snap()
    );
  }

  if (!slug || typeof slug !== "string") {
    return failResponse(
      log,
      "validate_fields",
      new Error("slug is required"),
      NextResponse.json({ error: "slug is required" }, { status: 400 }),
      snap()
    );
  }

  const slugErr = validateSlug(slug, { reserved: true });
  if (slugErr) {
    return failResponse(
      log,
      "validate_slug",
      new Error(slugErr),
      NextResponse.json({ error: slugErr }, { status: 400 }),
      snap()
    );
  }
  log.ok("validate_fields", { slug, name });

  const themeResult = parseThemeField(themeRaw);
  if (themeResult instanceof NextResponse) {
    return failResponse(log, "parse_theme", new Error("invalid theme"), themeResult, snap());
  }
  const theme = themeResult;
  log.ok("parse_theme");

  const logoResult = await parseLogoFile(logoFile);
  if (logoResult instanceof NextResponse) {
    return failResponse(log, "parse_logo", new Error("invalid logo"), logoResult, snap());
  }
  const logo_base64 = logoResult;
  log.ok("parse_logo", { hasLogo: !!logo_base64 });

  try {
    const result = await pool.query(
      `INSERT INTO api_docs.brands (slug, name, logo_base64, theme)
       VALUES ($1, $2, $3, $4)
       RETURNING id, slug, name, theme, created_at`,
      [slug, name, logo_base64, JSON.stringify(theme)]
    );
    log.ok("db_insert", { brandId: result.rows[0]?.id });
    log.done(201, { brandId: result.rows[0]?.id, slug });
    return withRequestId(
      NextResponse.json({ brand: result.rows[0] }, { status: 201 }),
      log.reqId
    );
  } catch (err: unknown) {
    if (isPgUniqueViolation(err)) {
      return failResponse(
        log,
        "db_insert",
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
      "db_insert",
      err,
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      snap()
    );
  }
}
