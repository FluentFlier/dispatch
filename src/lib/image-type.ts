/**
 * Detect an image's real MIME type + extension from its magic bytes.
 *
 * WHY: storage/CDNs frequently serve images as `application/octet-stream`, and
 * providers like LinkedIn reject those with 415 "unsupported_media_type". We
 * trust the content-type only when it is already an image/* type; otherwise we
 * sniff the leading bytes and fall back to JPEG.
 */
export function detectImageType(
  buf: Buffer | Uint8Array,
  contentType?: string | null,
): { mime: string; ext: string } {
  if (contentType && /^image\/(jpeg|png|gif|webp)/i.test(contentType)) {
    const ext = contentType.split('/')[1].split(';')[0].replace('jpeg', 'jpg');
    return { mime: contentType.split(';')[0], ext };
  }

  const b = buf;
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  // PNG: 89 50 4E 47
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  // GIF: 47 49 46
  if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  // WEBP: "RIFF"...."WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  // Unknown -> JPEG is the safest, most widely accepted default.
  return { mime: 'image/jpeg', ext: 'jpg' };
}
