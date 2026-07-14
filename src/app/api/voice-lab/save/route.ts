import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { syncBrainVoiceLab } from '@/lib/brain/sync';
import { storePersona } from '@/lib/supermemory';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { fetchOAuthDisplayName, resolveDisplayName } from '@/lib/user-display-name';
import { AUTH_COOKIE } from '@/lib/auth-cookies';
import { z } from 'zod';

const SaveSchema = z.object({
  voice_description: z.string(),
  voice_rules: z.string(),
  vocabulary_fingerprint: z.record(z.string(), z.unknown()),
  structural_patterns: z.record(z.string(), z.unknown()),
  exportable_prompt: z.string(),
  sample_posts: z.array(z.object({
    content: z.string(),
    platform: z.string().optional(),
  })).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  // Scope the brain + Supermemory writes to the active workspace so the WRITE tag
  // (workspace_${ws}) matches the READ tag generation now uses (break 7). Without
  // this, a persona trained via Voice Lab landed under the legacy user_ tag and
  // generation never found it.
  const workspaceId = (await getActiveWorkspaceId(user.id)) ?? undefined;

  // Persist the analyzed voice onto the creator_profile row.
  //
  // A blind upsert breaks the first-time-import flow: `display_name` is NOT NULL
  // with no default, so inserting a brand-new row with only the voice fields
  // trips a 23502 constraint violation. Users who imported LinkedIn posts before
  // finishing onboarding (no profile row yet) hit this on every save.
  //
  // Instead: update the existing row's voice fields when one exists, otherwise
  // insert a minimal row seeding the required `display_name` from the account
  // (email prefix, falling back to 'Creator'). Onboarding later upserts on the
  // same user_id conflict key and overwrites the placeholder name.
  const { data: existingProfile, error: lookupError } = await client.database
    .from('creator_profile')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (lookupError) {
    console.error('Profile lookup error:', lookupError);
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
  }

  let profileError: unknown = null;

  if (existingProfile) {
    // Row exists - only touch the voice fields so we never clobber display_name.
    const { error } = await client.database
      .from('creator_profile')
      .update({
        voice_description: parsed.data.voice_description,
        voice_rules: parsed.data.voice_rules,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);
    profileError = error;
  } else {
    // No row yet (import-before-onboarding) - insert with a seeded display_name.
    // Attach the active workspace_id when available so later workspace-scoped
    // reads (voice-context, brain sync) can find the row.
    const { data: membership } = await client.database
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .maybeSingle();

    const token = request.cookies.get(AUTH_COOKIE.access)?.value ?? '';
    const oauthName = user.name ?? (await fetchOAuthDisplayName(token));
    const displayName = resolveDisplayName({ oauthName });

    const { error } = await client.database
      .from('creator_profile')
      .insert([{
        user_id: user.id,
        workspace_id: membership?.workspace_id ?? null,
        display_name: displayName,
        voice_description: parsed.data.voice_description,
        voice_rules: parsed.data.voice_rules,
        updated_at: new Date().toISOString(),
      }]);
    profileError = error;
  }

  if (profileError) {
    console.error('Profile save error:', profileError);
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
  }

  // Store voice data in user_settings as JSON for the richer fields
  const settingsToSave = [
    { key: 'vocabulary_fingerprint', value: JSON.stringify(parsed.data.vocabulary_fingerprint) },
    { key: 'structural_patterns', value: JSON.stringify(parsed.data.structural_patterns) },
    { key: 'persona_prompt_export', value: parsed.data.exportable_prompt },
  ];

  if (parsed.data.sample_posts) {
    settingsToSave.push({
      key: 'sample_posts',
      value: JSON.stringify(parsed.data.sample_posts),
    });
  }

  for (const setting of settingsToSave) {
    await client.database
      .from('user_settings')
      .upsert({
        user_id: user.id,
        // voice-context reads these keys with a workspace_id filter when a
        // workspace is active - write the same workspace_id onboarding/ingest
        // uses so a manually-completed Voice Lab profile isn't invisible to
        // generation (would leave the "voice profile incomplete" banner lit).
        workspace_id: workspaceId ?? null,
        key: setting.key,
        value: setting.value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,key' });
  }

  try {
    await syncBrainVoiceLab(client, user.id, {
      voice_description: parsed.data.voice_description,
      voice_rules: parsed.data.voice_rules,
      vocabulary_fingerprint: parsed.data.vocabulary_fingerprint,
      structural_patterns: parsed.data.structural_patterns,
    }, workspaceId);
  } catch (err) {
    console.warn('Brain voice sync failed (non-critical):', err);
  }

  // Optional: Supermemory semantic layer when API key is set
  try {
    const personaContent = [
      `Voice: ${parsed.data.voice_description}`,
      `Rules: ${parsed.data.voice_rules}`,
      `Vocabulary: ${JSON.stringify(parsed.data.vocabulary_fingerprint)}`,
      `Patterns: ${JSON.stringify(parsed.data.structural_patterns)}`,
    ].join('\n\n');

    await storePersona(user.id, personaContent, {
      type: 'persona',
      hasExport: true,
    }, workspaceId);
  } catch (err) {
    // Supermemory is optional -- don't fail the save if it's unavailable
    console.warn('Supermemory store failed (non-critical):', err);
  }

  return NextResponse.json({ success: true });
}
