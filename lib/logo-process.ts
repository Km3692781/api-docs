const TRIM_THRESHOLD = 10;

type SharpFn = typeof import("sharp").default;

let sharpPromise: Promise<SharpFn | null> | null = null;

async function loadSharp(): Promise<SharpFn | null> {
  if (!sharpPromise) {
    sharpPromise = import("sharp")
      .then((m) => m.default)
      .catch((err) => {
        console.error("sharp unavailable:", err);
        return null;
      });
  }
  return sharpPromise;
}

/**
 * Trim empty / near-transparent padding from raster logos so the
 * artwork fills the sidebar and favicon. SVGs are returned unchanged.
 * Falls back to the original buffer if sharp is unavailable or trim fails.
 */
export async function trimLogoBuffer(
  input: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (mimeType === "image/svg+xml") {
    return { buffer: input, mimeType };
  }

  const sharp = await loadSharp();
  if (!sharp) {
    return { buffer: input, mimeType };
  }

  try {
    const buffer = await sharp(input)
      .rotate()
      .trim({ threshold: TRIM_THRESHOLD })
      .png()
      .toBuffer();
    return { buffer, mimeType: "image/png" };
  } catch (err) {
    console.error("trimLogoBuffer failed:", err);
    return { buffer: input, mimeType };
  }
}

/** Trim + fit into a square icon canvas for favicons. */
export async function makeLogoIcon(
  input: Buffer,
  mimeType: string,
  size = 64
): Promise<{ buffer: Buffer; mimeType: string }> {
  const sharp = await loadSharp();
  if (!sharp) {
    return { buffer: input, mimeType };
  }

  try {
    let pipeline = sharp(input).rotate();
    if (mimeType !== "image/svg+xml") {
      pipeline = pipeline.trim({ threshold: TRIM_THRESHOLD });
    }
    const buffer = await pipeline
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    return { buffer, mimeType: "image/png" };
  } catch (err) {
    console.error("makeLogoIcon failed:", err);
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
  if (typeof dataUri !== "string" || !dataUri.startsWith("data:")) {
    return null;
  }
  const comma = dataUri.indexOf(",");
  if (comma === -1) return null;

  const meta = dataUri.slice(5, comma); // after "data:"
  const payload = dataUri.slice(comma + 1);
  const mimeType = meta.split(";")[0]?.trim() || "application/octet-stream";
  const isBase64 = /;base64/i.test(meta);

  try {
    const buffer = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    if (buffer.length === 0) return null;
    return { mimeType, buffer };
  } catch {
    return null;
  }
}
