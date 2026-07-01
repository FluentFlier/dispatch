/**
 * Phase: image type detection (fix LinkedIn 415)
 *
 * Storage often serves images as application/octet-stream, which LinkedIn
 * rejects. detectImageType must sniff magic bytes and return a real image mime.
 */
import { describe, it, expect } from 'vitest';
import { detectImageType } from '@/lib/image-type';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe('Phase: image type detection', () => {
  it('trusts a real image content-type (normalizing jpeg->jpg)', () => {
    expect(detectImageType(JPEG, 'image/jpeg')).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detectImageType(PNG, 'image/png')).toEqual({ mime: 'image/png', ext: 'png' });
  });

  it('sniffs magic bytes when content-type is octet-stream', () => {
    expect(detectImageType(JPEG, 'application/octet-stream')).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detectImageType(PNG, 'application/octet-stream')).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detectImageType(GIF, null)).toEqual({ mime: 'image/gif', ext: 'gif' });
    expect(detectImageType(WEBP, undefined)).toEqual({ mime: 'image/webp', ext: 'webp' });
  });

  it('falls back to jpeg for unknown bytes', () => {
    expect(detectImageType(Buffer.from([0, 1, 2, 3]), 'application/octet-stream')).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
  });
});
