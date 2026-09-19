/**
 * Client-side logo helpers: trim transparent padding and build a square favicon.
 * Works even when server-side sharp is unavailable (e.g. some Vercel builds).
 */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function findContentBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number
): { top: number; left: number; right: number; bottom: number } | null {
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > alphaThreshold) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  if (right < left || bottom < top) return null;
  return { top, left, right, bottom };
}

/** Returns a PNG data URL with transparent padding cropped away. */
export async function cropLogoTransparent(
  src: string,
  alphaThreshold = 8
): Promise<string | null> {
  try {
    const img = await loadImage(src);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
    const bounds = findContentBounds(data, w, h, alphaThreshold);
    if (!bounds) return null;

    const cw = bounds.right - bounds.left + 1;
    const ch = bounds.bottom - bounds.top + 1;

    // Already tight enough — no need to replace src
    if (cw >= w * 0.92 && ch >= h * 0.92) {
      return null;
    }

    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    const octx = out.getContext("2d");
    if (!octx) return null;
    octx.drawImage(canvas, bounds.left, bounds.top, cw, ch, 0, 0, cw, ch);
    return out.toDataURL("image/png");
  } catch (err) {
    console.error("cropLogoTransparent failed:", err);
    return null;
  }
}

/** Crop transparent padding, then fit into a square PNG data URL for favicons. */
export async function cropLogoIcon(
  src: string,
  size = 64,
  alphaThreshold = 8
): Promise<string | null> {
  try {
    const cropped = await cropLogoTransparent(src, alphaThreshold);
    const img = await loadImage(cropped ?? src);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;

    const out = document.createElement("canvas");
    out.width = size;
    out.height = size;
    const ctx = out.getContext("2d");
    if (!ctx) return null;

    const scale = Math.min(size / w, size / h);
    const dw = Math.max(1, Math.round(w * scale));
    const dh = Math.max(1, Math.round(h * scale));
    const dx = Math.floor((size - dw) / 2);
    const dy = Math.floor((size - dh) / 2);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, dx, dy, dw, dh);
    return out.toDataURL("image/png");
  } catch (err) {
    console.error("cropLogoIcon failed:", err);
    return null;
  }
}
