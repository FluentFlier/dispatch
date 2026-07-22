export type ThinkContextMessage = { role: 'user' | 'assistant'; content: string };

/** Keep Think history inside the jobs API contract and include current files/images. */
export function buildThinkDiscussionContext(
  messages: ThinkContextMessage[],
  attachmentBlock: string,
): ThinkContextMessage[] {
  const history = messages
    .map(({ role, content }) => ({ role, content: content.trim().slice(0, 20_000) }))
    .filter(({ content }) => content.length > 0);
  const attachmentContext = attachmentBlock.trim().slice(0, 20_000);
  if (attachmentContext) history.push({ role: 'user', content: attachmentContext });
  return history.slice(-30);
}
