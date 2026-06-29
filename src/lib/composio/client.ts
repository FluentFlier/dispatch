import { Composio } from '@composio/core';
import { isComposioConfigured } from '@/lib/composio/config';

let client: Composio | null = null;

export function getComposioClient(): Composio | null {
  if (!isComposioConfigured()) return null;
  if (!client) {
    client = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY,
      host: 'content-os-signals',
    });
  }
  return client;
}

/** Stable Composio entity ID scoped to workspace + connecting user */
export function toComposioUserId(workspaceId: string, userId: string): string {
  return `ws_${workspaceId}_u_${userId}`;
}
