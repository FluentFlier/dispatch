const BASE_URL = 'https://api.supermemory.ai/v3';

// Hard timeout on every Supermemory call. These run inline on user-facing routes
// (publish/import/edit/event/story writes, and retrieval on /api/generate). Without
// a bound, a slow or hung Supermemory would stall the request — and imports issue
// one write per post, so 25 hung writes would freeze the whole import. On timeout
// the fetch rejects and the caller's try/catch degrades gracefully.
const SM_TIMEOUT_MS = Number(process.env.SUPERMEMORY_TIMEOUT_MS ?? 8000);

function getApiKey(): string {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) throw new Error('Missing SUPERMEMORY_API_KEY env var');
  return key;
}

async function smFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(SM_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Supermemory API error (${res.status}): ${text}`);
  }

  if (res.status === 204) return {} as T;
  return res.json();
}

export interface AddMemoryParams {
  content: string;
  containerTags?: string[];
  customId?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface MemoryDocument {
  id: string;
  title?: string;
  summary?: string;
  status?: string;
  customId?: string;
  containerTags?: string[];
  metadata?: Record<string, string | number | boolean>;
  createdAt?: string;
  updatedAt?: string;
}

export interface SearchResult {
  id: string;
  score: number;
  content?: string;
  metadata?: Record<string, string | number | boolean>;
  documentId?: string;
}

export async function addMemory(params: AddMemoryParams): Promise<MemoryDocument> {
  return smFetch<MemoryDocument>('/documents', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function searchMemories(
  query: string,
  containerTags?: string[],
  limit = 5,
): Promise<{ results: SearchResult[] }> {
  return smFetch<{ results: SearchResult[] }>('/search', {
    method: 'POST',
    body: JSON.stringify({
      q: query,
      containerTags,
      topK: limit,
    }),
  });
}

export async function listMemories(
  containerTags?: string[],
  limit = 20,
  page = 1,
): Promise<{ memories: MemoryDocument[] }> {
  return smFetch<{ memories: MemoryDocument[] }>('/documents/list', {
    method: 'POST',
    body: JSON.stringify({ containerTags, limit, page }),
  });
}

export async function deleteMemory(id: string): Promise<void> {
  await smFetch<void>(`/documents/${id}`, { method: 'DELETE' });
}

/**
 * Store a user's persona in Supermemory for semantic retrieval.
 * When workspaceId is provided the persona is scoped to that workspace's
 * container tag (`workspace_${workspaceId}`) so agency clients maintain
 * independent voice profiles. Without workspaceId falls back to the
 * legacy `user_${userId}` tag for backwards compatibility.
 * customId prevents duplicate entries on re-run.
 */
export async function storePersona(
  userId: string,
  personaContent: string,
  metadata?: Record<string, string | number | boolean>,
  workspaceId?: string,
): Promise<MemoryDocument> {
  // Use workspace-scoped container tag when available; fall back to user tag
  // so personal/legacy accounts continue to work without changes.
  const scopeTag = workspaceId ? `workspace_${workspaceId}` : `user_${userId}`;
  return addMemory({
    content: personaContent,
    containerTags: [scopeTag, 'persona'],
    customId: `persona_${userId}`,
    metadata: { type: 'persona', userId, ...metadata },
  });
}

/**
 * Search a user's stored memories for context relevant to content generation.
 * When workspaceId is provided searches the workspace-scoped container tag
 * so results are isolated to the correct agency client. Without workspaceId
 * falls back to the legacy `user_${userId}` tag for personal accounts.
 */
export async function searchUserContext(
  userId: string,
  query: string,
  limit = 5,
  workspaceId?: string,
): Promise<SearchResult[]> {
  // Resolve the correct container tag — workspace-scoped for agency clients,
  // user-scoped for personal/legacy accounts.
  const scopeTag = workspaceId ? `workspace_${workspaceId}` : `user_${userId}`;
  const { results } = await searchMemories(query, [scopeTag], limit);
  return results;
}
