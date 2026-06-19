import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const BUCKET = 'post-media';

/**
 * Verify the file's actual content by inspecting its leading magic bytes.
 * The client-declared MIME type is not trusted; an attacker could label a
 * script/HTML payload as image/png. Returns true only when the bytes match an
 * allowed image signature.
 */
function hasAllowedImageSignature(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // GIF: 47 49 46
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
  // WEBP: "RIFF" (52 49 46 46) at 0 and "WEBP" (57 45 42 50) at 8
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return true;
  }
  return false;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `File too large. Max size: ${MAX_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // Read the file once and verify its actual bytes match an allowed image
    // signature. The client-declared file.type is not trusted on its own.
    const arrayBuffer = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    if (!hasAllowedImageSignature(buf)) {
      return NextResponse.json(
        { error: 'Unsupported or corrupted image file.' },
        { status: 400 }
      );
    }

    const client = getServerClient();
    const ext = EXTENSION_BY_TYPE[file.type] ?? 'jpg';
    const fileName = `${user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

    // Reuse the already-read bytes for the upload so the file is not read twice.
    const uploadBlob = new Blob([arrayBuffer], { type: file.type });

    const { data, error } = await client.storage
      .from(BUCKET)
      .upload(fileName, uploadBlob);

    if (error) {
      console.error('[Upload] Storage error:', error);
      return NextResponse.json(
        { error: 'Upload failed. Make sure the post-media bucket exists in InsForge.' },
        { status: 500 }
      );
    }

    const fileKey = data?.key ?? fileName;
    const publicUrl = client.storage.from(BUCKET).getPublicUrl(fileKey);

    return NextResponse.json({
      url: typeof publicUrl === 'string' ? publicUrl : (publicUrl as { data?: { publicUrl?: string } })?.data?.publicUrl ?? '',
      path: fileKey,
      size: file.size,
      type: file.type,
    });
  } catch (err) {
    console.error('[Upload] Unexpected error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
