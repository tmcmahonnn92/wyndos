import "server-only";
import sharp from "sharp";

/**
 * Logos for invoices: see-through PNGs (and WebP/GIF) come out with a black background in
 * PDFs. Put the logo on white, keep it a sensible size, and save it as a plain PNG.
 * Returns the original if it can't be read, or null if it isn't an image at all.
 */
export async function flattenLogo(dataUri: string | null | undefined): Promise<string | null> {
  const m = String(dataUri ?? "").match(/^data:image\/(png|jpe?g|webp|gif);base64,([\s\S]+)$/i);
  if (!m) return null;
  try {
    const out = await sharp(Buffer.from(m[2], "base64"), { animated: false })
      .flatten({ background: "#ffffff" })
      .resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return `data:image/png;base64,${out.toString("base64")}`;
  } catch {
    return /^(png|jpe?g)$/i.test(m[1]) ? String(dataUri) : null;
  }
}
