import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { logError } from '@/lib/logger';

/** Reject uploads larger than this to bound request time. ~10MB. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Cap extracted text so a huge attachment can't blow up the prompt/cost. */
const MAX_TEXT_CHARS = 20000;

/**
 * Extracts plain text from an uploaded .txt/.md or .pdf file so the composer
 * can fold it into the generation prompt as context. Returns { name, text }.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No valid file provided.' }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: 'File is empty.' }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10MB).' }, { status: 413 });
  }

  const name = file instanceof File ? file.name : 'upload';
  const isPdf = file.type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    let text: string;
    if (isPdf) {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        text = result.text?.trim() ?? '';
      } finally {
        await parser.destroy();
      }
    } else {
      text = buffer.toString('utf8');
    }
    return NextResponse.json({ name, text: text.slice(0, MAX_TEXT_CHARS) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to read file';
    logError('[Generate ParseFile API] Error', undefined, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
