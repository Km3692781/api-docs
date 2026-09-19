import sharp from "sharp";

const TRIM_THRESHOLD = 10;

/**
 * Trim empty / near-transparent padding from raster logos so the
 * artwork fills the sidebar and favicon. SVGs are returned unchanged.
 */
export async function trimLogoBuffer(
  input: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (mimeType === "image/svg+xml") {
    return { buffer: input, mimeType };
  }

  try {
    const buffer = await sharp(input)
      .rotate()
      .trim({ threshold: TRIM_THRESHOLD })
      .png()
      .toBuffer();
    return { buffer, mimeType: "image/png" };
  } catch {
    // Fully transparent / unsupported → keep original
    return { buffer: input, mimeType };
  }
}

/** Trim + fit into a square icon canvas for favicons. */
export async function makeLogoIcon(
  input: Buffer,
  mimeType: string,
  size = 64
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (mimeType === "image/svg+xml") {
    // Rasterize SVG into a square icon
    try {
      const buffer = await sharp(input)
        .resize(size, size, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      return { buffer, mimeType: "image/png" };
    } catch {
      return { buffer: input, mimeType };
    }
  }

  try {
    const buffer = await sharp(input)
      .rotate()
      .trim({ threshold: TRIM_THRESHOLD })
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    return { buffer, mimeType: "image/png" };
  } catch {
    return { buffer: input, mimeType };
  }
}

export function bufferToDataUri(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export function parseDataUri(dataUri: string): {
  mimeType: string;
  buffer: Buffer;
} | null {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUri);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}
