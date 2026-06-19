import type { createClient } from '@insforge/sdk';
import { sendAyrshareCommentReply, ayrshareCommentsAvailable } from '@/lib/engagement/ayrshare-comments';
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

type InsforgeClient = ReturnType<typeof createClient>;

export type InboxFilter = 'all' | 'needs_reply' | 'drafted' | 'sent';

function classifyComment(queue: CommentReplyQueueRow | null): {
  needs_reply: boolean;
  drafted: boolean;
  sent: boolean;
} {
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

  const groupsMap = new Map<string, InboxPostGroup>();

  let totalNeeds = 0;
  let totalDrafted = 0;
  let totalSent = 0;

  for (const comment of commentRows) {
    const queue = queueByComment.get(comment.id) ?? null;
    const flags = classifyComment(queue);

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

    const inboxComment: InboxComment = { comment, queue };
    group.comments.push(inboxComment);
    group.stats.total++;
    if (flags.needs_reply) group.stats.needs_reply++;
    if (flags.drafted) group.stats.drafted++;
    if (flags.sent) group.stats.sent++;
  }

  const groups = Array.from(groupsMap.values()).sort((a, b) =>
    b.comments[0]?.comment.synced_at.localeCompare(a.comments[0]?.comment.synced_at ?? '') ?? 0,
  );

  return {
    groups,
    summary: {
      posts: groups.length,
      comments: groups.reduce((n, g) => n + g.comments.length, 0),
      needs_reply: totalNeeds,
      drafted: totalDrafted,
      sent: totalSent,
    },
  };
}

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

  const postIds = Array.from(new Set(commentRows.map((c) => c.post_id)));
  const { data: posts } = await client.database
    .from('posts')
    .select('id, title')
    .eq('user_id', userId)
    .in('id', postIds);
  const titleByPost = new Map(
    ((posts ?? []) as Array<{ id: string; title: string }>).map((p) => [p.id, p.title]),
  );

  for (const comment of commentRows) {
    if (drafted >= limit) break;
    if (blocked.has(comment.id)) {
      skipped++;
      continue;
    }

    try {
      const result = await generateWithVoicePipeline({
        userPrompt: buildReplyPrompt(comment, titleByPost.get(comment.post_id) ?? 'Post'),
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
    return { sent: 0, failed: 0, stubbed: 0, errors, items };
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

  const useAyrshare = ayrshareCommentsAvailable();

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

      if (useAyrshare) {
        const reply = await sendAyrshareCommentReply({
          userId,
          providerCommentId: comment.provider_comment_id,
          platform: comment.platform,
          replyText: row.draft_reply,
          searchPlatformId: true,
        });
        provider_reply_id = reply.provider_reply_id;
        wasStubbed = reply.stubbed;
      } else {
        wasStubbed = true;
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
      if (wasStubbed) stubbed++;
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

  return { sent, failed, stubbed, errors, items };
}
