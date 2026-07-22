import { waitUntil } from '@vercel/functions';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient, getServiceClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { guardAiRequest } from '@/lib/ai-guard';
import { chatCompletion, LlmError } from '@/lib/llm';
import { resolveWriteModel, withWriteModel } from '@/lib/write-models';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { ensurePillarBriefs } from '@/lib/pillars/briefs-generate';
import { classifyPromptForMemory } from '@/lib/memory/classify-prompt';
import { runContentPipeline, type PipelineStage } from '@/lib/content-pipeline';
import { streamCreatorDraft } from '@/lib/content-pipeline/stream';
import { evaluateDraft } from '@/lib/voice-evaluator';
import { heuristicAiScore, humanizePipeline } from '@/lib/humanizer';
import { trackEvent } from '@/lib/analytics';
import { formatSignalTopicsBlock, getSignalTopicsForGeneration } from '@/lib/signals/content-bridge';
import {
  loadGenerationContext,
  recordRegen,
  REGEN_LIGHT_LIMIT,
  saveGenerationContext,
} from '@/lib/generation-context';
import { ChatMessagesSchema, deriveChatTitle, type ChatMessagePayload } from '@/lib/chats-schema';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const GenStageSchema = z.enum(['thinking', 'writing', 'revising', 'polishing', 'scoring']);
type GenStage = z.infer<typeof GenStageSchema>;

const JobSchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  userMessage: z.object({
    id: z.string().max(64),
    content: z.string().min(1).max(20_000),
  }),
  assistantId: z.string().max(64),
  prompt: z.string().min(1).max(10_000),
  topic: z.string().max(500).optional(),
  platform: z.enum(['twitter', 'linkedin', 'instagram', 'threads']).nullable().optional(),
  pillar: z.string().max(60).optional(),
  mode: z.enum(['draft', 'revise', 'think']).optional(),
  modelId: z.string().max(64).optional(),
  discussionContext: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20_000) })).max(30).optional(),
  useVoice: z.boolean().optional(),
  mentions: z.array(z.string().max(100)).max(10).optional(),
  context_id: z.string().uuid().nullable().optional(),
});

type JobPayload = z.infer<typeof JobSchema>;
type ChatMessage = ChatMessagePayload;

const STAGE_UI: Record<PipelineStage, GenStage> = {
  research: 'thinking',
  base: 'writing',
  hooks: 'writing',
  humanize: 'polishing',
  voice: 'writing',
  evaluate: 'scoring',
};

async function updateAssistantMessage(
  conversationId: string,
  userId: string,
  assistantId: string,
  patch: Partial<ChatMessage>,
): Promise<void> {
  const client = getServiceClient();
  const { data, error } = await client.database
    .from('chat_conversations')
    .select('messages')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data || !Array.isArray(data.messages)) return;

  const messages = (data.messages as ChatMessage[]).map((m) =>
    m.id === assistantId && m.role === 'assistant' ? { ...m, ...patch } : m,
  );

  await client.database
    .from('chat_conversations')
    .update({ messages, updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('user_id', userId);
}

async function runGenerationJob(job: JobPayload, userId: string, workspaceId: string | null): Promise<void> {
  const client = getServiceClient();
  const useVoice = job.useVoice !== false;
  const mode = job.mode ?? 'draft';
  const platform = job.platform ?? undefined;

  try {
    await updateAssistantMessage(job.conversationId!, userId, job.assistantId, {
      status: 'running',
      stage: mode === 'revise' ? 'revising' : 'thinking',
      error: undefined,
    });

    if (mode === 'think') {
      const history = (job.discussionContext ?? []).slice(-12)
        .map((m) => `${m.role === 'user' ? 'Creator' : 'Assistant'}: ${m.content}`)
        .join('\n\n');
      const response = await chatCompletion(
        'You are a thoughtful content strategy partner. Help the creator brainstorm, compare choices, and reason through decisions. Be concise and practical. Do not turn the answer into a finished social post unless explicitly asked.',
        `${history ? `CONVERSATION:\n${history}\n\n` : ''}LATEST QUESTION:\n${job.userMessage.content}`,
        { role: 'generate', maxTokens: 1200 },
      );
      await updateAssistantMessage(job.conversationId!, userId, job.assistantId, {
        content: response, kind: 'discussion', status: 'done', stage: null,
      });
      return;
    }

    const cached =
      mode === 'revise' && job.context_id
        ? await loadGenerationContext(client, job.context_id, userId)
        : null;
    const doFullReload = Boolean(cached && cached.regenCount >= REGEN_LIGHT_LIMIT);

    let signalBlock = '';
    if (!cached && workspaceId) {
      const topics = await getSignalTopicsForGeneration(client, workspaceId);
      signalBlock = formatSignalTopicsBlock(topics);
    }

    const memoryPlan =
      !cached && useVoice
        ? await classifyPromptForMemory(job.prompt)
        : { topics: [] as string[], time_scope: 'any' as const, search_query: '' };
    const memoryLimit = memoryPlan.time_scope === 'specific' ? 10 : 3;

    const voiceContext =
      !cached && useVoice
        ? await loadCreatorVoiceContext(client, userId, {
            memoryQuery: memoryPlan.search_query || job.topic || job.prompt.slice(0, 200),
            memoryLimit,
            workspaceId: workspaceId ?? undefined,
            platform,
          })
        : null;

    const profile = cached ? cached.profile : voiceContext?.profile ?? null;
    // Gradually backfill generation briefs onto custom pillars that predate them
    // (a couple per run), so every pillar eventually steers drafting like a
    // built-in. Fire-and-forget: never blocks or breaks generation.
    if (workspaceId) void ensurePillarBriefs(client, userId, workspaceId).catch(() => {});
    const contextAdditions = cached ? cached.contextAdditions ?? '' : voiceContext?.contextAdditions ?? '';
    const vocabulary = cached ? cached.vocabulary : voiceContext?.vocabulary;
    const structural = cached ? cached.structural : voiceContext?.structural;
    const completeness = voiceContext?.completeness;
    const mergedContext = [contextAdditions, signalBlock].filter(Boolean).join('\n') || undefined;

    if (mode === 'draft' || doFullReload) {
      const result = await runContentPipeline({
        userPrompt: job.prompt,
        profile,
        contextAdditions: mergedContext,
        platform,
        contentType: 'post',
        useVoice,
        mentions: job.mentions,
        hooksClient: client,
        vocabulary,
        structural,
        userId,
        onStage: (stage) => {
          void updateAssistantMessage(job.conversationId!, userId, job.assistantId, {
            status: 'running',
            stage: STAGE_UI[stage] ?? 'writing',
          });
        },
      });

      let contextId: string | null = null;
      if (doFullReload && cached) {
        await recordRegen(client, cached.id, result.text, 0);
        contextId = cached.id;
      } else {
        contextId = await saveGenerationContext(client, {
          userId,
          workspaceId,
          userPrompt: job.prompt,
          contextAdditions: mergedContext,
          profile,
          vocabulary,
          structural,
          mentions: job.mentions,
          platform,
          contentType: 'post',
          lastDraft: result.text,
        });
      }

      await updateAssistantMessage(job.conversationId!, userId, job.assistantId, {
        content: result.text,
        status: 'done',
        stage: null,
        contextId,
        voiceMetrics: {
          used_hook_ids: result.usedHookIds ?? [],
          ai_score: result.ai_score,
          voice_match_score: result.voice_match_score,
          evaluation: result.evaluation,
        },
        completeness: {
          starved: completeness?.starved ?? false,
          voiceSource: completeness?.voiceSource,
        },
      });

      void trackEvent('generation_complete', {
        platform: platform ?? 'unknown',
        hooks_used: result.usedHookIds?.length ?? 0,
        mode,
        background: true,
        streamed: false,
        humanized: true,
      });
      return;
    }

    let started = false;
    const result = await streamCreatorDraft(
      {
        userPrompt: job.prompt,
        profile,
        contextAdditions: mergedContext,
        platform,
        useVoice,
        mode,
        mentions: job.mentions,
        hooksClient: client,
      },
      () => {
        if (started) return;
        started = true;
        void updateAssistantMessage(job.conversationId!, userId, job.assistantId, {
          status: 'running',
          stage: 'writing',
        });
      },
    );

    let finalText = result.text;
    let humanized = false;
    try {
      await updateAssistantMessage(job.conversationId!, userId, job.assistantId, {
        status: 'running',
        stage: 'polishing',
      });
      const polished = await humanizePipeline(result.text, {
        profile: null,
        skipVoice: true,
        skipAudit: false,
        vocabulary,
      });
      finalText = polished.text;
      humanized = true;
    } catch (err) {
      console.error('[generate/jobs] auto-humanize failed (non-fatal):', err);
    }

    const aiSlop = heuristicAiScore(finalText);
    let voiceMatchScore: number | null = null;
    let evaluation: Awaited<ReturnType<typeof evaluateDraft>> | undefined;
    if (useVoice) {
      await updateAssistantMessage(job.conversationId!, userId, job.assistantId, {
        status: 'running',
        stage: 'scoring',
      });
      evaluation = await evaluateDraft(finalText, profile, contextAdditions || undefined, 'post');
      if (!evaluation.parse_error) {
        voiceMatchScore = Math.round((evaluation.persona_fidelity / 10) * 100);
      }
    }

    if (cached) await recordRegen(client, cached.id, finalText, cached.regenCount + 1);

    await updateAssistantMessage(job.conversationId!, userId, job.assistantId, {
      content: finalText,
      status: 'done',
      stage: null,
      contextId: cached?.id ?? null,
      voiceMetrics: {
        used_hook_ids: result.usedHookIds,
        ai_score: aiSlop,
        voice_match_score: voiceMatchScore,
        evaluation,
      },
      completeness: {
        starved: completeness?.starved ?? false,
        voiceSource: completeness?.voiceSource,
      },
    });

    void trackEvent('generation_complete', {
      platform: platform ?? 'unknown',
      hooks_used: result.usedHookIds.length,
      mode,
      background: true,
      streamed: true,
      humanized,
    });
  } catch (err) {
    const message =
      err instanceof LlmError && err.isQuota
        ? 'AI provider quota exhausted. Top up credits or switch LLM_* provider env.'
        : 'Generation failed.';
    console.error('[generate/jobs] failed:', err);
    await updateAssistantMessage(job.conversationId!, userId, job.assistantId, {
      status: 'error',
      stage: null,
      error: message,
    });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = JobSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const selectedModel = resolveWriteModel(parsed.data.modelId);
  if (!selectedModel) return NextResponse.json({ error: 'Selected model is not available.' }, { status: 400 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? 'Rate limited' }, { status: guard.status });

  const client = getServerClient();
  try {
    const workspaceId = await getActiveWorkspaceId(user.id);
    const userMsg: ChatMessage = {
      id: parsed.data.userMessage.id,
      role: 'user',
      content: parsed.data.userMessage.content.trim(),
      kind: 'prompt',
    };
    const assistantMsg: ChatMessage = {
      id: parsed.data.assistantId,
      role: 'assistant',
      content: '',
      kind: parsed.data.mode === 'think' ? 'discussion' : 'draft',
      status: 'queued',
      stage: parsed.data.mode === 'revise' ? 'revising' : 'thinking',
    };

    let conversationId = parsed.data.conversationId ?? null;
    let messages: ChatMessage[];

    if (conversationId) {
      const { data, error } = await client.database
        .from('chat_conversations')
        .select('messages')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data || !Array.isArray(data.messages)) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
      messages = [...(data.messages as ChatMessage[]), userMsg, assistantMsg];
      const { error: updateError } = await client.database
        .from('chat_conversations')
        .update({
          messages,
          platform: parsed.data.platform ?? null,
          pillar: parsed.data.pillar ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .eq('user_id', user.id);
      if (updateError) throw updateError;
    } else {
      messages = [userMsg, assistantMsg];
      const { data, error } = await client.database
        .from('chat_conversations')
        .insert([{
          user_id: user.id,
          workspace_id: workspaceId ?? null,
          title: deriveChatTitle(messages),
          platform: parsed.data.platform ?? null,
          pillar: parsed.data.pillar ?? null,
          messages,
        }])
        .select('id, title, updated_at')
        .single();
      if (error) throw error;
      conversationId = data?.id ?? null;
    }

    if (!conversationId) return NextResponse.json({ error: 'Could not create job' }, { status: 500 });

    waitUntil(withWriteModel(selectedModel, () => runGenerationJob({ ...parsed.data, conversationId }, user.id, workspaceId)));
    return NextResponse.json({ conversationId, messages }, { status: 202 });
  } catch (err) {
    return errorResponse('Failed to start generation.', 500, err);
  }
}
