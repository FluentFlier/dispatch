import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { createRule, listRules } from '@/lib/signals/rules/store';
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

const CreateRuleSchema = z
  .object({
    name: z.string().min(1).max(120),
    platform: z.enum(['x', 'linkedin', 'any']).optional(),
    conditions: ConditionsSchema.optional(),
    action_mode: z.enum(['notify_only', 'notify_and_draft', 'auto_send']).optional(),
    channels: z
      .array(z.enum(['linkedin_connect', 'linkedin_dm', 'x_dm', 'gmail', 'copy', 'dashboard']))
      .optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    const rules = await listRules(client, workspaceId);
    return NextResponse.json({ rules });
  } catch (err) {
    return errorResponse('Could not load rules.', 500, err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  let body: z.infer<typeof CreateRuleSchema>;
  try {
    body = CreateRuleSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const rule = await createRule(client, workspaceId, {
      name: body.name.trim(),
      platform: body.platform,
      conditions: body.conditions,
      action_mode: body.action_mode,
      channels: body.channels,
      enabled: body.enabled,
    });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    return errorResponse('Could not create rule.', 500, err);
  }
}
