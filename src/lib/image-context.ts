const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const MAX_IMAGE_CONTEXT_SIZE = 10 * 1024 * 1024;

export function validateImageContextFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return 'Choose a JPEG, PNG, WebP, or GIF image.';
  if (file.size > MAX_IMAGE_CONTEXT_SIZE) return 'Image is too large. Maximum size is 10MB.';
  return null;
}

export function isOwnedImageKey(key: string, userId: string): boolean {
  return key.startsWith(`${userId}/`) && /^[A-Za-z0-9_./-]+$/.test(key) && !key.includes('..');
}
