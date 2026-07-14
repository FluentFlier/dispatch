import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { importLeadsFromFile, MAX_IMPORT_BYTES } from '@/lib/signals/leads/import-leads';
import { detectImportFileKind } from '@/lib/signals/leads/import-parse';
import { errorResponse } from '@/lib/api-errors';

export const runtime = 'nodejs';
export const maxDuration = 120;

const ALLOWED_EXT = new Set(['csv', 'tsv', 'txt', 'xlsx', 'xls', 'json', 'pdf']);

/**
 * POST /api/leads/import
 * Multipart upload: CSV, XLSX, JSON, PDF, or plain text → manual leads + LinkedIn resolve.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json(
        { error: 'Unsupported file type. Use CSV, XLSX, JSON, PDF, or TXT.' },
        { status: 400 },
      );
    }

    if (file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json({ error: 'File too large (max 5MB).' }, { status: 400 });
    }

    const resolveContacts = formData.get('resolve') !== 'false';
    const buffer = Buffer.from(await file.arrayBuffer());
    const client = getServerClient();

    const result = await importLeadsFromFile(
      client,
      workspaceId,
      { buffer, filename: file.name, mimeType: file.type || undefined },
      { resolveContacts },
    );

    return NextResponse.json({
      result,
      kind: detectImportFileKind(file.name, file.type),
    });
  } catch (err) {
    return errorResponse('Lead import failed.', 500, err);
  }
}
