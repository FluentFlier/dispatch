/**
 * Outbound engagement queue: AI-drafted comments/reactions on OTHER people's
 * posts, approved by the user, then posted by a cron worker.
 *
 * Uses lease-based locking so overlapping cron runs never double-post,
 * bounded attempts, per-account daily caps, and human-mimicking delays
 * between actions — LinkedIn restricts accounts whose activity looks robotic.
 */
import type { createClient } from '@insforge/sdk';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { getUnipileAccountId } from '@/lib/engagement/unipile-comments';
import {
  checkDailyUsage,
  incrementDailyUsage,
  randomDelay,
  throwIfNotOk,
} from '@/lib/social/reliability';
import { logError, logInfo } from '@/lib/logger';

type InsforgeClient = ReturnType<typeof createClient>;

export type EngagementTaskStatus =
  | 'draft'
  | 'approved'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'skipped';

export interface EngagementTaskRow {
  id: string;
  user_id: string;
  platform: string;
  kind: 'comment' | 'reaction';
  target_provider_post_id: string;
  target_post_url: string | null;
  target_author_name: string | null;
  target_post_excerpt: string | null;
  source: string;
  comment_text: string | null;
  reaction_type: string;
  status: EngagementTaskStatus;
  attempts: number;
  max_attempts: number;
  lease_id: string | null;
  lease_expires_at: string | null;
  scheduled_at: string;
  sent_at: string | null;
  provider_result_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// --- Claim eligibility ---

/**
 * Whether a task is safe for a worker to claim right now: approved, due,
 * under its attempt budget, and not leased by a live worker. Pure so the
 * exact double-posting guard is unit-testable.
 */
export function isTaskClaimable(
  task: Pick<
    EngagementTaskRow,
    'status' | 'scheduled_at' | 'attempts' | 'max_attempts' | 'lease_expires_at'
  >,
  now: Date = new Date(),
): boolean {
  if (task.status !== 'approved') return false;
  if (new Date(task.scheduled_at).getTime() > now.getTime()) return false;
  if (task.attempts >= task.max_attempts) return false;
  if (task.lease_expires_at && new Date(task.lease_expires_at).getTime() > now.getTime()) {
    return false;
  }
  return true;
}

// --- Drafting ---

export interface DraftOutboundInput {
  targetPostExcerpt: string;
  targetAuthorName?: string;
  platform?: string;
  fast?: boolean;
}

/**
 * Drafts an outbound comment in the creator's voice for someone else's post.
 * Reuses the same voice pipeline as inbox reply drafting so outbound comments
 * sound like the creator, not like a bot doing "great post!" spam.
 */
export async function draftOutboundComment(
  client: InsforgeClient,
  userId: string,
  input: DraftOutboundInput,
): Promise<{ text: string; voice_match_score: number | null }> {
  const { profile, contextAdditions } = await loadCreatorVoiceContext(client, userId);

  const author = input.targetAuthorName ? ` by ${input.targetAuthorName}` : '';
  const userPrompt = [
    `You are commenting on a LinkedIn post${author}. The post says:`,
    `"""${input.targetPostExcerpt.slice(0, 1500)}"""`,
    '',
    'Write a short, specific comment (1-3 sentences) that adds a genuine insight,',
    'observation, or question. Never use generic praise ("Great post!"),',
    'never pitch, never use hashtags or emojis unless the creator voice does.',
  ].join('\n');

  const result = await generateWithVoicePipeline({
    userPrompt,
    profile,
    contextAdditions: contextAdditions || undefined,
    platform: input.platform ?? 'linkedin',
    contentType: 'reply',
    fast: input.fast ?? true,
  });

  return { text: result.text, voice_match_score: result.voice_match_score ?? null };
}

// --- Posting via Unipile ---

function getUnipileBase(): string {
  const dsn = process.env.UNIPILE_DSN;
  if (!dsn) throw new Error('UNIPILE_DSN is not configured');
  return `https://${dsn.replace(/\/$/, '')}/api/v1`;
}

async function unipilePost(path: string, body: Record<string, unknown>): Promise<Response> {
  const key = process.env.UNIPILE_API_KEY;
  if (!key) throw new Error('UNIPILE_API_KEY is not configured');
  return fetch(`${getUnipileBase()}${path}`, {
    method: 'POST',
    headers: {
      'X-API-KEY': key,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Posts the task's comment or reaction to the target post. NOT retried on
 * transient errors: a timeout may mean the action actually landed, and a
 * duplicate comment is worse than a failed attempt (the queue's attempt
 * counter handles the retry on a later run instead).
 */
async function performTask(
  accountId: string,
  task: EngagementTaskRow,
): Promise<{ providerResultId: string | null }> {
  if (task.kind === 'comment') {
    if (!task.comment_text) throw new Error('Comment task has no comment_text');
    const res = await throwIfNotOk(
      await unipilePost(`/posts/${encodeURIComponent(task.target_provider_post_id)}/comments`, {
        account_id: accountId,
        text: task.comment_text,
      }),
      'Unipile post comment',
    );
    const json = (await res.json()) as { id?: string; comment_id?: string };
    return { providerResultId: json.id ?? json.comment_id ?? null };
  }

  const res = await throwIfNotOk(
    await unipilePost('/posts/reaction', {
      account_id: accountId,
      post_id: task.target_provider_post_id,
      reaction_type: task.reaction_type || 'like',
    }),
    'Unipile post reaction',
  );
  const json = (await res.json()) as { id?: string };
  return { providerResultId: json.id ?? null };
}

// --- Worker ---

export interface RunQueueResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}

const LEASE_DURATION_MINUTES = 10;
/** Each queue action costs one Unipile call; cap shared with sync (100/day). */
const ACTIONS_PER_TASK = 1;

/**
 * Processes due approved tasks. Claim protocol (lease pattern):
 * write a fresh lease_id via a conditional update keyed on status='approved',
 * then re-read and verify OUR lease_id won. Two overlapping workers can both
 * try; only one's uuid survives the write, the other sees a foreign lease and
 * moves on — the DB is the arbiter, not process memory.
 */
export async function runEngagementTaskQueue(
  client: InsforgeClient,
  limit = 5,
): Promise<RunQueueResult> {
  const now = new Date();
  const result: RunQueueResult = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  const { data: candidates, error } = await client.database
    .from('engagement_tasks')
    .select('*')
    .eq('status', 'approved')
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit * 2);
  if (error) throw new Error(error.message);

  const due = ((candidates ?? []) as EngagementTaskRow[])
    .filter((t) => isTaskClaimable(t, now))
    .slice(0, limit);

  for (const task of due) {
    result.processed++;

    const leaseId = crypto.randomUUID();
    const leaseExpires = new Date(Date.now() + LEASE_DURATION_MINUTES * 60 * 1000).toISOString();

    const { error: claimError } = await client.database
      .from('engagement_tasks')
      .update({
        status: 'processing',
        lease_id: leaseId,
        lease_expires_at: leaseExpires,
        attempts: task.attempts + 1,
      })
      .eq('id', task.id)
      .eq('status', 'approved');
    if (claimError) {
      result.skipped++;
      continue;
    }

    // Verify our lease won (another worker may have claimed between read and write).
    const { data: claimedRows } = await client.database
      .from('engagement_tasks')
      .select('lease_id')
      .eq('id', task.id)
      .limit(1);
    if ((claimedRows?.[0] as { lease_id: string | null } | undefined)?.lease_id !== leaseId) {
      result.skipped++;
      continue;
    }

    try {
      const accountId = await getUnipileAccountId(task.user_id, task.platform);
      if (!accountId) throw new Error(`No Unipile account connected for ${task.platform}`);

      const usageCheck = checkDailyUsage(accountId, ACTIONS_PER_TASK);
      if (!usageCheck.allowed) {
        // Out of budget today — release the task untouched for tomorrow.
        await client.database
          .from('engagement_tasks')
          .update({
            status: 'approved',
            lease_id: null,
            lease_expires_at: null,
            attempts: task.attempts, // budget skip is not a failed attempt
            last_error: 'Daily engagement budget reached — deferred',
          })
          .eq('id', task.id);
        result.skipped++;
        continue;
      }

      const { providerResultId } = await performTask(accountId, task);
      incrementDailyUsage(accountId, ACTIONS_PER_TASK);

      await client.database
        .from('engagement_tasks')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_result_id: providerResultId,
          lease_id: null,
          lease_expires_at: null,
          last_error: null,
        })
        .eq('id', task.id);
      result.sent++;
      logInfo('[engagement-tasks] sent', { taskId: task.id, kind: task.kind });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const exhausted = task.attempts + 1 >= task.max_attempts;
      await client.database
        .from('engagement_tasks')
        .update({
          status: exhausted ? 'failed' : 'approved',
          lease_id: null,
          lease_expires_at: null,
          last_error: message.slice(0, 500),
        })
        .eq('id', task.id);
      result.failed++;
      logError('[engagement-tasks] task failed', { taskId: task.id, exhausted, message });
    }

    // Human-mimicking gap between outbound actions (well above sync pacing —
    // these are visible writes on LinkedIn, not reads).
    await randomDelay(1000, 3000);
  }

  return result;
}

