import { NextResponse } from "next/server";
import { bufferToDataUri, trimLogoBuffer } from "@/lib/logo-process";

export const RESERVED_BRAND_SLUGS = ["api", "admin", "_next", "favicon.ico"];

const SLUG_RE = /^[a-z0-9-]+$/;
const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

export function validateSlug(
  slug: string,
  opts?: { reserved?: boolean }
): string | null {
  if (!SLUG_RE.test(slug)) {
    return "slug must only contain lowercase letters, numbers, and hyphens";
  }
  if (opts?.reserved && RESERVED_BRAND_SLUGS.includes(slug)) {
    return `slug "${slug}" is reserved`;
  }
  return null;
}

export type BrandTheme = { primary?: string; accent?: string };

/** Parse theme JSON. Returns theme object or an error NextResponse. */
export function parseThemeField(
  themeRaw: FormDataEntryValue | null
): BrandTheme | NextResponse {
  if (themeRaw === null || themeRaw === undefined || themeRaw === "") {
    return {};
  }
  if (typeof themeRaw !== "string") {
    return NextResponse.json(
      { error: "theme must be valid JSON" },
      { status: 400 }
    );
  }

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

  const theme: BrandTheme = {};
  for (const key of allowedKeys) {
    const val = obj[key];
    if (val !== undefined) {
      if (typeof val !== "string" || !HEX_RE.test(val)) {
        return NextResponse.json(
          { error: `theme.${key} must be a hex color like "#FF4500"` },
          { status: 400 }
        );
      }
      theme[key as "primary" | "accent"] = val;
    }
  }
  return theme;
}

/** Convert logo File to data URI, or null if absent. Returns error NextResponse on bad type. */
export async function parseLogoFile(
  logoFile: FormDataEntryValue | null
): Promise<string | null | NextResponse> {
  if (!logoFile || !(logoFile instanceof File) || logoFile.size === 0) {
    return null;
  }
  if (!LOGO_TYPES.includes(logoFile.type)) {
    return NextResponse.json(
      { error: "logo must be a PNG, JPEG, SVG, or WebP file" },
      { status: 400 }
    );
  }
  const raw = Buffer.from(await logoFile.arrayBuffer());
  const processed = await trimLogoBuffer(raw, logoFile.type);
  return bufferToDataUri(processed.buffer, processed.mimeType);
}

export function isPgUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}
