import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { deleteRule, updateRule } from '@/lib/signals/rules/store';
import { errorResponse } from '@/lib/api-errors';

const ConditionsSchema = z
  .object({
    signal_types: z
      .array(z.enum(['accelerator_join', 'funding_round', 'role_change', 'launch', 'other']))
      .optional(),
    source_types: z
      .array(z.enum(['account', 'company_page', 'person_profile', 'keyword_search']))
      .optional(),
    keywords: z.array(z.string().min(1).max(80)).max(50).optional(),
  })
  .strict();

const UpdateRuleSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    platform: z.enum(['x', 'linkedin', 'any']).optional(),
    conditions: ConditionsSchema.optional(),
    action_mode: z.enum(['notify_only', 'notify_and_draft', 'auto_send']).optional(),
    channels: z
      .array(z.enum(['linkedin_connect', 'linkedin_dm', 'x_dm', 'gmail', 'copy', 'dashboard']))
      .optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: { ruleId: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  let body: z.infer<typeof UpdateRuleSchema>;
  try {
    body = UpdateRuleSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const rule = await updateRule(client, workspaceId, params.ruleId, body);
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    return NextResponse.json({ rule });
  } catch (err) {
    return errorResponse('Could not update rule.', 500, err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { ruleId: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    await deleteRule(client, workspaceId, params.ruleId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse('Could not delete rule.', 500, err);
  }
}
