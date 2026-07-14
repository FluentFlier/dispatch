/**
 * Agent skill instructions served at GET /api/agent/v1/skill.
 * Copy this into Claude/Cursor agent skills or reference the URL directly.
 */
export function buildAgentSkillMarkdown(appUrl: string): string {
  const base = appUrl.replace(/\/$/, '');
  return `# Content OS Agent

Connect your AI agent to Content OS - generate posts in your voice, manage the library, publish, reply to comments, and triage Signals.

## Setup

1. Open **Settings → Tools → Agent access** in Content OS.
2. Create an API key (default scopes: \`read\`, \`write\`).
3. Add \`publish\` or \`outreach\` scopes only if the agent should post or send DMs.

\`\`\`bash
export CONTENT_OS_API_KEY="cos_live_..."
export CONTENT_OS_URL="${base}"
\`\`\`

Every request:

\`\`\`
Authorization: Bearer $CONTENT_OS_API_KEY
Content-Type: application/json
\`\`\`

Optional workspace header when the user has multiple workspaces:

\`\`\`
X-Content-OS-Workspace: <workspace-uuid>
\`\`\`

## Scopes

| Scope | Allows |
|-------|--------|
| \`read\` | Session, list posts, engagement inbox, signals |
| \`write\` | Generate content, create posts, draft comment replies |
| \`publish\` | Publish or schedule posts |
| \`outreach\` | Draft/send signal outreach (use with care) |

## Core workflow

### 1. Bootstrap

\`\`\`bash
curl -s "$CONTENT_OS_URL/api/agent/v1/session" \\
  -H "Authorization: Bearer $CONTENT_OS_API_KEY" | jq
\`\`\`

Returns user, workspace, connected platforms, and available endpoints.

### 2. Generate a post in the creator's voice

\`\`\`bash
curl -s -X POST "$CONTENT_OS_URL/api/agent/v1/generate" \\
  -H "Authorization: Bearer $CONTENT_OS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "Write a LinkedIn post about shipping faster with AI agents",
    "platform": "linkedin",
    "contentType": "post"
  }' | jq '.text'
\`\`\`

### 3. Save to library

\`\`\`bash
curl -s -X POST "$CONTENT_OS_URL/api/agent/v1/posts" \\
  -H "Authorization: Bearer $CONTENT_OS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Shipping faster with AI agents",
    "pillar": "building-in-public",
    "platform": "linkedin",
    "caption": "<paste generated text>",
    "status": "edited"
  }' | jq '.post.id'
\`\`\`

### 4. Publish (requires \`publish\` scope)

\`\`\`bash
curl -s -X POST "$CONTENT_OS_URL/api/agent/v1/publish" \\
  -H "Authorization: Bearer $CONTENT_OS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "postId": "<uuid>",
    "platform": "linkedin",
    "content": "<caption text>"
  }' | jq
\`\`\`

### 5. Engagement loop

\`\`\`bash
# Sync comments from connected accounts
curl -s -X POST "$CONTENT_OS_URL/api/agent/v1/engagement/sync" \\
  -H "Authorization: Bearer $CONTENT_OS_API_KEY"

# List comments needing replies
curl -s "$CONTENT_OS_URL/api/agent/v1/engagement/inbox?filter=needs_reply" \\
  -H "Authorization: Bearer $CONTENT_OS_API_KEY" | jq '.groups[].comments | length'

# Draft AI replies in the creator voice
curl -s -X POST "$CONTENT_OS_URL/api/agent/v1/engagement/draft-replies" \\
  -H "Authorization: Bearer $CONTENT_OS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"limit": 10}' | jq
\`\`\`

### 6. Signals (B2B pipeline)

\`\`\`bash
curl -s "$CONTENT_OS_URL/api/agent/v1/signals?status=pending&limit=20" \\
  -H "Authorization: Bearer $CONTENT_OS_API_KEY" | jq '.events[] | {id, person_name, signal_type}'
\`\`\`

### 7. Warm contacts (UseSocial-style social graph)

People who reacted to **your** posts - triage ICPs, draft connection notes.

\`\`\`bash
# Sync reactions from recent published posts (cached reads, 15m TTL)
curl -s -X POST "$CONTENT_OS_URL/api/agent/v1/warm-contacts" \\
  -H "Authorization: Bearer $CONTENT_OS_API_KEY"

# List ICP bucket
curl -s "$CONTENT_OS_URL/api/agent/v1/warm-contacts?category=ICP" \\
  -H "Authorization: Bearer $CONTENT_OS_API_KEY" | jq '.buckets.ICP'

# Draft connect note (requires outreach scope)
curl -s -X POST "$CONTENT_OS_URL/api/agent/v1/warm-contacts/<contact-id>/draft" \\
  -H "Authorization: Bearer $CONTENT_OS_API_KEY"

# Send connect invite (requires outreach scope + Signals safety enabled)
curl -s -X POST "$CONTENT_OS_URL/api/agent/v1/warm-contacts/<contact-id>/send" \\
  -H "Authorization: Bearer $CONTENT_OS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"note": "optional override; uses saved draft if omitted"}'
\`\`\`

## Safety defaults

- New keys default to **read + write** only - not publish or outreach.
- Human review in the Content OS UI is still recommended before sending outreach.
- Revoke keys anytime in Settings → Tools → Agent access.

## Discovery

\`GET /api/agent/v1\` - machine-readable capability list.
\`GET /api/agent/v1/skill\` - this document.
`;
}
