import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

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

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { error: "slug must only contain lowercase letters, numbers, and hyphens" },
      { status: 400 }
    );
  }

  const reserved = ["api", "admin", "_next", "favicon.ico"];
  if (reserved.includes(slug)) {
    return NextResponse.json(
      { error: `slug "${slug}" is reserved` },
      { status: 400 }
    );
  }

  // Parse theme JSON — only primary and accent are accepted
  let theme: { primary?: string; accent?: string } = {};
  if (themeRaw && typeof themeRaw === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(themeRaw);
    } catch {
      return NextResponse.json(
        { error: "theme must be valid JSON" },
        { status: 400 }
      );
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "theme must be a JSON object" },
        { status: 400 }
      );
    }

    const obj = parsed as Record<string, unknown>;

    // Reject any keys other than primary and accent
    const allowedKeys = ["primary", "accent"];
    const extraKeys = Object.keys(obj).filter((k) => !allowedKeys.includes(k));
    if (extraKeys.length > 0) {
      return NextResponse.json(
        {
          error: `theme only accepts "primary" and "accent". Remove: ${extraKeys.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const hexRe = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
    for (const key of allowedKeys) {
      const val = obj[key];
      if (val !== undefined) {
        if (typeof val !== "string" || !hexRe.test(val)) {
          return NextResponse.json(
            { error: `theme.${key} must be a hex color like "#FF4500"` },
            { status: 400 }
          );
        }
        theme[key as "primary" | "accent"] = val;
      }
    }
  }

  // Convert logo file to base64 if provided
  let logo_base64: string | null = null;
  if (logoFile && logoFile instanceof File) {
    const allowedTypes = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
    if (!allowedTypes.includes(logoFile.type)) {
      return NextResponse.json(
        { error: "logo must be a PNG, JPEG, SVG, or WebP file" },
        { status: 400 }
      );
    }
    const buffer = await logoFile.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    logo_base64 = `data:${logoFile.type};base64,${base64}`;
  }

  try {
    const result = await pool.query(
      `INSERT INTO api_docs.brands (slug, name, logo_base64, theme)
       VALUES ($1, $2, $3, $4)
       RETURNING id, slug, name, theme, created_at`,
      [slug, name, logo_base64, JSON.stringify(theme)]
    );

    return NextResponse.json({ brand: result.rows[0] }, { status: 201 });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      return NextResponse.json(
        { error: `brand with slug "${slug}" already exists` },
        { status: 409 }
      );
    }
    console.error("Create brand error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}