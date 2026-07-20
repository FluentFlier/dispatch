import type { createClient } from '@insforge/sdk';
import { sendUnipileCommentReply, unipileCommentsAvailable } from '@/lib/engagement/unipile-comments';
import type {
  CommentReplyQueueRow,
  DraftRepliesInput,
  DraftRepliesResult,
  EngagementInboxResult,
  InboxComment,
  InboxPostGroup,
  PostCommentRow,
  ReplyQueueStatus,
  SendRepliesInput,
  SendRepliesResult,
} from '@/lib/engagement/types';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { isEnabled } from '@/lib/feature-flags';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { generateContent } from '@/lib/ai';
import { getActiveWorkspaceId } from '@/lib/workspace';

type InsforgeClient = ReturnType<typeof createClient>;

export type InboxFilter = 'all' | 'needs_reply' | 'drafted' | 'sent';

function classifyComment(
  queue: CommentReplyQueueRow | null,
  answeredNatively = false,
): {
  needs_reply: boolean;
  drafted: boolean;
  sent: boolean;
} {
  // A reply the creator wrote on LinkedIn itself counts as answered. Reply state
  // used to come only from comment_reply_queue - a table this app alone writes -
  // so every comment they had already handled still read "Needs a reply".
  if (answeredNatively) {
    return { needs_reply: false, drafted: false, sent: true };
  }
  if (!queue) {
    return { needs_reply: true, drafted: false, sent: false };
  }
  if (queue.status === 'sent') {
    return { needs_reply: false, drafted: false, sent: true };
  }
  if (queue.status === 'skipped') {
    return { needs_reply: true, drafted: false, sent: false };
  }
  if (queue.status === 'draft' || queue.status === 'approved') {
    return { needs_reply: false, drafted: true, sent: false };
  }
  if (queue.status === 'failed') {
    return { needs_reply: true, drafted: false, sent: false };
  }
  return { needs_reply: true, drafted: false, sent: false };
}

function matchesFilter(
  filter: InboxFilter,
  flags: ReturnType<typeof classifyComment>,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'needs_reply') return flags.needs_reply;
  if (filter === 'drafted') return flags.drafted;
  if (filter === 'sent') return flags.sent;
  return true;
}

function buildReplyPrompt(comment: PostCommentRow, postTitle: string): string {
  return `Write a reply to this comment on your post "${postTitle}".

PLATFORM: ${comment.platform}
COMMENT AUTHOR: ${comment.author_name ?? comment.author_handle ?? 'Someone'}
COMMENT:
${comment.comment_text}

Return ONLY the reply text. No labels, no quotes around the whole reply.`;
}

export async function getEngagementInbox(
  client: InsforgeClient,
  userId: string,
  filter: InboxFilter = 'all',
  postId?: string,
): Promise<EngagementInboxResult> {
  let commentsQuery = client.database
    .from('post_comments')
    .select('*')
    .eq('user_id', userId)
    .order('commented_at', { ascending: false });

  if (postId) {
    commentsQuery = commentsQuery.eq('post_id', postId);
  }

  const { data: comments, error: commentsError } = await commentsQuery;

  if (commentsError) throw new Error(commentsError.message);

  const commentRows = (comments ?? []) as PostCommentRow[];
  if (commentRows.length === 0) {
    return {
      groups: [],
      summary: { posts: 0, comments: 0, needs_reply: 0, drafted: 0, sent: 0 },
      canSendReplies: unipileCommentsAvailable(),
    };
  }

  const commentIds = commentRows.map((c) => c.id);
  const postIds = Array.from(new Set(commentRows.map((c) => c.post_id)));

  const { data: queueRows } = await client.database
    .from('comment_reply_queue')
    .select('*')
    .eq('user_id', userId)
    .in('post_comment_id', commentIds)
    .order('created_at', { ascending: false });

  const queueByComment = new Map<string, CommentReplyQueueRow>();
  for (const q of (queueRows ?? []) as CommentReplyQueueRow[]) {
    if (!queueByComment.has(q.post_comment_id)) {
      queueByComment.set(q.post_comment_id, q);
    }
  }

  const { data: posts } = await client.database
    .from('posts')
    .select('id, title, platform')
    .eq('user_id', userId)
    .in('id', postIds);

  const postMap = new Map(
    ((posts ?? []) as Array<{ id: string; title: string; platform: string }>).map((p) => [
      p.id,
      p,
    ]),
  );

  const { data: jobs } = await client.database
    .from('publish_jobs')
    .select('post_id, provider_post_id')
    .eq('user_id', userId)
    .eq('status', 'published')
    .in('post_id', postIds);

  const providerPostByPostId = new Map<string, string | null>();
  for (const j of (jobs ?? []) as Array<{ post_id: string; provider_post_id: string | null }>) {
    if (j.provider_post_id && !providerPostByPostId.has(j.post_id)) {
      providerPostByPostId.set(j.post_id, j.provider_post_id);
    }
  }

  // Thread replies are context, not inbox items: show the top-level comment and
  // use its children only to decide whether it has already been answered.
  const ownReplyParents = new Set(
    commentRows.filter((c) => c.is_own && c.parent_comment_id).map((c) => c.parent_comment_id as string),
  );
  const topLevel = commentRows.filter((c) => !c.parent_comment_id && !c.is_own);

  const groupsMap = new Map<string, InboxPostGroup>();

  let totalNeeds = 0;
  let totalDrafted = 0;
  let totalSent = 0;

  for (const comment of topLevel) {
    const queue = queueByComment.get(comment.id) ?? null;
    const flags = classifyComment(queue, ownReplyParents.has(comment.id));

    if (!matchesFilter(filter, flags)) continue;

    if (flags.needs_reply) totalNeeds++;
    if (flags.drafted) totalDrafted++;
    if (flags.sent) totalSent++;

    const post = postMap.get(comment.post_id);
    const postTitle = post?.title ?? 'Untitled post';
    const postPlatform = post?.platform ?? comment.platform;

    let group = groupsMap.get(comment.post_id);
    if (!group) {
      group = {
        post_id: comment.post_id,
        post_title: postTitle,
        post_platform: postPlatform,
        provider_post_id: providerPostByPostId.get(comment.post_id) ?? null,
        comments: [],
        stats: { total: 0, needs_reply: 0, drafted: 0, sent: 0 },
      };
      groupsMap.set(comment.post_id, group);
    }

    const inboxComment: InboxComment = {
      comment,
      queue,
      answered_natively: ownReplyParents.has(comment.id),
    };
    group.comments.push(inboxComment);
    group.stats.total++;
    if (flags.needs_reply) group.stats.needs_reply++;
    if (flags.drafted) group.stats.drafted++;
    if (flags.sent) group.stats.sent++;
  }

  // Fixed operator precedence: the previous expression applied ?? 0 to the
  // entire localeCompare chain, which silently returned 0 when either synced_at
  // was undefined - treating unequal items as equal and producing random sort order.
  const groups = Array.from(groupsMap.values()).sort((a, b) => {
    const bDate = b.comments[0]?.comment.synced_at ?? '';
    const aDate = a.comments[0]?.comment.synced_at ?? '';
    return bDate.localeCompare(aDate);
  });

  return {
    groups,
    summary: {
      posts: groups.length,
      comments: groups.reduce((n, g) => n + g.comments.length, 0),
      needs_reply: totalNeeds,
      drafted: totalDrafted,
      sent: totalSent,
    },
    canSendReplies: unipileCommentsAvailable(),
  };
}

/** Maximum Haiku signal-detection calls allowed per workspace per engagement-draft run.
 * Dual-cap pattern: this per-run cap prevents any single cron execution from burning the
 * full daily Haiku budget. The daily hard cap in ai-budget.ts is the absolute ceiling.
 * Both guards must be present - per-run for spike protection, per-day for total cost control.
 */
const MAX_HAIKU_PER_RUN = 25;

/** Generic comment phrases that never contain actionable content signals.
 * Pre-filtered client-side before any Haiku call to eliminate noise LLM calls.
 */
const GENERIC_PHRASES = ['great post', 'so true', 'love this', 'thanks for sharing', 'well said'];

export async function draftEngagementReplies(
  client: InsforgeClient,
  userId: string,
  input: DraftRepliesInput = {},
): Promise<DraftRepliesResult> {
  const limit = Math.min(input.limit ?? 20, 50);
  const errors: string[] = [];
  const items: DraftRepliesResult['items'] = [];
  let drafted = 0;
  let skipped = 0;

  let commentsQuery = client.database
    .from('post_comments')
    .select('*')
    .eq('user_id', userId)
    .order('synced_at', { ascending: false })
    .limit(limit * 3);

  if (input.commentIds?.length) {
    commentsQuery = commentsQuery.in('id', input.commentIds);
  }

  const { data: comments, error } = await commentsQuery;
  if (error) throw new Error(error.message);

  const commentRows = (comments ?? []) as PostCommentRow[];
  if (commentRows.length === 0) {
    return { drafted: 0, skipped: 0, errors, items };
  }

  const ids = commentRows.map((c) => c.id);
  const { data: existingQueue } = await client.database
    .from('comment_reply_queue')
    .select('post_comment_id, status')
    .eq('user_id', userId)
    .in('post_comment_id', ids)
    .in('status', ['draft', 'approved', 'sent']);

  const blocked = new Set(
    ((existingQueue ?? []) as Array<{ post_comment_id: string }>).map(
      (q) => q.post_comment_id,
    ),
  );

  const { profile, contextAdditions } = await loadCreatorVoiceContext(client, userId);

  // Resolve workspace once for the entire run - needed for signal detection budget checks
  const workspaceId = await getActiveWorkspaceId(userId);

  const postIds = Array.from(new Set(commentRows.map((c) => c.post_id)));
  const { data: posts } = await client.database
    .from('posts')
    .select('id, title')
    .eq('user_id', userId)
    .in('id', postIds);
  const titleByPost = new Map(
    ((posts ?? []) as Array<{ id: string; title: string }>).map((p) => [p.id, p.title]),
  );

  // --- L5: Per-Run Signal Detection Cap ---
  // Declared outside the loop so it persists across all comment iterations.
  // Dual-cap pattern: this resets per engagement-draft invocation, not per day.
  let haikusUsed = 0;

  // Check feature flag once per run - avoids N async flag reads inside the loop
  const signalsEnabled = workspaceId
    ? await isEnabled(client, 'layer5_engagement_signals')
    : false;

  for (const comment of commentRows) {
    if (drafted >= limit) break;
    if (blocked.has(comment.id)) {
      skipped++;
      continue;
    }

    const postTitle = titleByPost.get(comment.post_id) ?? 'Post';

    try {
      const result = await generateWithVoicePipeline({
        userPrompt: buildReplyPrompt(comment, postTitle),
        profile,
        contextAdditions: contextAdditions || undefined,
        platform: comment.platform,
        contentType: 'reply',
        fast: input.fast ?? false,
      });

      const { data: inserted, error: insertError } = await client.database
        .from('comment_reply_queue')
        .insert([
          {
            user_id: userId,
            post_comment_id: comment.id,
            draft_reply: result.text,
            status: 'draft' as ReplyQueueStatus,
            voice_match_score: result.voice_match_score,
            evaluation: result.evaluation ?? null,
          },
        ])
        .select('id')
        .single();

      if (insertError) {
        errors.push(insertError.message);
        skipped++;
        continue;
      }

      drafted++;
      items.push({
        comment_id: comment.id,
        queue_id: (inserted as { id: string }).id,
        draft_reply: result.text,
        voice_match_score: result.voice_match_score,
      });

      // --- L5: Comment Signal Detection (Step 2) ---
      // Runs after the reply draft succeeds - never blocks or delays the reply path.
      // Dual-cap guard: feature flag + per-run Haiku cap. Daily hard cap enforced inside
      // checkAndIncrementUsage. Both caps must be satisfied before any LLM call fires.
      if (signalsEnabled && workspaceId && haikusUsed < MAX_HAIKU_PER_RUN) {
        const budget = await checkAndIncrementUsage(client, workspaceId, 'haiku');

        if (budget === 'blocked') {
          // Mark processed even when budget is exhausted - prevents re-scan on next cron run
          await client.database
            .from('post_comments')
            .update({ signal_processed_at: new Date().toISOString() })
            .eq('id', comment.id);
        } else {
          const text = comment.comment_text ?? '';
          const isGeneric =
            text.length < 50 ||
            GENERIC_PHRASES.some((p) => text.toLowerCase().includes(p));

          if (!isGeneric) {
            try {
              const signalPrompt = `Is this comment asking a question worth a full post? Does it reveal a perspective worth addressing? Could it serve as a hook for a follow-up post?\n\nCOMMENT: "${text.slice(0, 500)}"\n\nReturn ONLY valid JSON: {"is_signal": boolean, "angle": "string or empty", "pillar": "general|ai|tech|founder_story|hot_take|event_recap|other"}`;
              const raw = await generateContent(signalPrompt, undefined, undefined, null);
              const parsed = JSON.parse(
                raw.replace(/```json|```/g, '').trim(),
              ) as { is_signal: boolean; angle: string; pillar: string };

              if (parsed.is_signal && parsed.angle) {
                await client.database
                  .from('post_comments')
                  .update({
                    is_content_signal: true,
                    content_angle: parsed.angle,
                    signal_processed_at: new Date().toISOString(),
                  })
                  .eq('id', comment.id);

                await client.database.from('content_ideas').insert({
                  user_id: userId,
                  workspace_id: workspaceId,
                  idea: parsed.angle,
                  pillar: parsed.pillar,
                  source: 'from_comment',
                  source_comment_id: comment.id,
                  status: 'suggested',
                  notes: `From reply to "${postTitle}" - @${comment.author_handle ?? 'unknown'}`,
                  converted: false,
                });
              } else {
                await client.database
                  .from('post_comments')
                  .update({ signal_processed_at: new Date().toISOString() })
                  .eq('id', comment.id);
              }
              haikusUsed++;
            } catch (err) {
              console.error('[l5/signal] detection failed (non-blocking):', err);
              await client.database
                .from('post_comments')
                .update({ signal_processed_at: new Date().toISOString() })
                .eq('id', comment.id);
            }
          }
        }
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Draft failed');
      skipped++;
    }
  }

  return { drafted, skipped, errors, items };
}

export async function sendEngagementReplies(
  client: InsforgeClient,
  userId: string,
  input: SendRepliesInput = {},
): Promise<SendRepliesResult> {
  const errors: string[] = [];
  const items: SendRepliesResult['items'] = [];
  let sent = 0;
  let failed = 0;
  let stubbed = 0;

  const useUnipile = unipileCommentsAvailable();
  if (!useUnipile) {
    // Fail closed: never pretend sends succeeded when the provider is unavailable.
    throw Object.assign(
      new Error(
        'Cannot send replies: Unipile is not configured. Set UNIPILE_API_KEY and UNIPILE_DSN, then connect LinkedIn or X in Settings.',
      ),
      { code: 'UNIPILE_UNAVAILABLE' as const },
    );
  }

  let queueQuery = client.database
    .from('comment_reply_queue')
    .select('*')
    .eq('user_id', userId);

  if (input.queueIds?.length) {
    queueQuery = queueQuery.in('id', input.queueIds);
  } else if (input.approveFirst) {
    queueQuery = queueQuery.eq('status', 'draft');
  } else {
    queueQuery = queueQuery.eq('status', 'approved');
  }

  const { data: queueRows, error: queueError } = await queueQuery;
  if (queueError) throw new Error(queueError.message);

  const rows = (queueRows ?? []) as CommentReplyQueueRow[];
  if (rows.length === 0) {
    return { sent: 0, failed: 0, stubbed: 0, errors, items, canSend: true };
  }

  const commentIds = rows.map((r) => r.post_comment_id);
  const { data: comments } = await client.database
    .from('post_comments')
    .select('*')
    .eq('user_id', userId)
    .in('id', commentIds);

  const commentMap = new Map(
    ((comments ?? []) as PostCommentRow[]).map((c) => [c.id, c]),
  );

  const postIds = Array.from(
    new Set(((comments ?? []) as PostCommentRow[]).map((c) => c.post_id)),
  );
  const { data: jobs } = await client.database
    .from('publish_jobs')
    .select('post_id, platform, provider_post_id')
    .eq('user_id', userId)
    .eq('status', 'published')
    .in('post_id', postIds)
    .not('provider_post_id', 'is', null);

  const socialPostIdByKey = new Map<string, string>();
  for (const job of (jobs ?? []) as Array<{
    post_id: string;
    platform: string;
    provider_post_id: string;
  }>) {
    const key = `${job.post_id}:${job.platform}`;
    if (!socialPostIdByKey.has(key)) {
      socialPostIdByKey.set(key, job.provider_post_id);
    }
  }

  for (const queueRow of rows) {
    let row = queueRow;
    const comment = commentMap.get(row.post_comment_id);
    if (!comment) {
      failed++;
      errors.push(`Queue ${row.id}: comment not found`);
      continue;
    }

    const overrideText = input.draftOverrides?.[row.id];
    if (overrideText !== undefined && overrideText !== row.draft_reply) {
      await client.database
        .from('comment_reply_queue')
        .update({ draft_reply: overrideText })
        .eq('id', row.id)
        .eq('user_id', userId);
      row = { ...row, draft_reply: overrideText };
    }

    if (input.approveFirst && row.status === 'draft') {
      await client.database
        .from('comment_reply_queue')
        .update({ status: 'approved' })
        .eq('id', row.id)
        .eq('user_id', userId);
    }

    try {
      let provider_reply_id: string | null = null;
      let wasStubbed = false;

      const socialPostId = socialPostIdByKey.get(`${comment.post_id}:${comment.platform}`);
      if (!socialPostId) {
        failed++;
        errors.push(
          `Queue ${row.id}: no published post id for reply target (${comment.platform})`,
        );
        items.push({
          queue_id: row.id,
          status: 'failed',
          provider_reply_id: null,
        });
        await client.database
          .from('comment_reply_queue')
          .update({
            status: 'failed',
            last_error: 'Missing published post id for reply target',
          })
          .eq('id', row.id)
          .eq('user_id', userId);
        continue;
      }

      const reply = await sendUnipileCommentReply({
        userId,
        socialPostId,
        providerCommentId: comment.provider_comment_id,
        platform: comment.platform,
        replyText: row.draft_reply,
      });
      provider_reply_id = reply.provider_reply_id;
      wasStubbed = reply.stubbed;

      if (wasStubbed) {
        // Provider returned a stub (e.g. missing account) - do not mark sent.
        stubbed++;
        errors.push(
          `Queue ${row.id}: reply not sent (provider unavailable for ${comment.platform}). Connect the account in Settings.`,
        );
        items.push({
          queue_id: row.id,
          status: row.status === 'draft' ? 'approved' : row.status,
          provider_reply_id: null,
        });
        continue;
      }

      const { error: updateError } = await client.database
        .from('comment_reply_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_reply_id,
          last_error: null,
        })
        .eq('id', row.id)
        .eq('user_id', userId);

      if (updateError) throw new Error(updateError.message);

      sent++;
      items.push({
        queue_id: row.id,
        status: 'sent',
        provider_reply_id,
      });
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : 'Send failed';
      errors.push(`Queue ${row.id}: ${msg}`);
      await client.database
        .from('comment_reply_queue')
        .update({ status: 'failed', last_error: msg })
        .eq('id', row.id)
        .eq('user_id', userId);
      items.push({
        queue_id: row.id,
        status: 'failed',
        provider_reply_id: null,
      });
    }
  }

  return { sent, failed, stubbed, errors, items, canSend: true };
}
