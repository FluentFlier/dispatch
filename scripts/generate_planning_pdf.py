"""
Content OS — Planning Document PDF Generator
Run: python scripts/generate_planning_pdf.py
Output: docs/content-os-planning-jun2026.pdf
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER
import os

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "content-os-planning-jun2026.pdf")
os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

# ── Colours ──────────────────────────────────────────────────────────────────
DARK       = colors.HexColor("#09090B")
SURFACE    = colors.HexColor("#18181B")
CORAL      = colors.HexColor("#EB5E55")
AMBER      = colors.HexColor("#F5A623")
GREEN      = colors.HexColor("#22C55E")
MUTED      = colors.HexColor("#71717A")
WHITE      = colors.white
LIGHT_GRAY = colors.HexColor("#F4F4F5")
RED_BG     = colors.HexColor("#FEF2F2")
AMBER_BG   = colors.HexColor("#FFFBEB")
GREEN_BG   = colors.HexColor("#F0FDF4")
BLUE_BG    = colors.HexColor("#EFF6FF")
BLUE       = colors.HexColor("#3B82F6")

# ── Styles ────────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def S(name, **kw):
    return ParagraphStyle(name, **kw)

TITLE     = S("CT", fontName="Helvetica-Bold", fontSize=28, leading=34, textColor=DARK, spaceAfter=6)
SUBTITLE  = S("CS", fontName="Helvetica", fontSize=13, leading=18, textColor=MUTED, spaceAfter=20)
H1        = S("H1", fontName="Helvetica-Bold", fontSize=16, leading=22, textColor=DARK, spaceBefore=20, spaceAfter=8)
H2        = S("H2", fontName="Helvetica-Bold", fontSize=13, leading=18, textColor=DARK, spaceBefore=14, spaceAfter=6)
H3        = S("H3", fontName="Helvetica-Bold", fontSize=11, leading=15, textColor=DARK, spaceBefore=10, spaceAfter=4)
BODY      = S("BD", fontName="Helvetica", fontSize=10, leading=15, textColor=DARK, spaceAfter=5)
BODY_MUT  = S("BM", fontName="Helvetica", fontSize=10, leading=15, textColor=MUTED, spaceAfter=5)
BULLET    = S("BL", fontName="Helvetica", fontSize=10, leading=15, textColor=DARK, leftIndent=14, spaceAfter=3, bulletIndent=4)
CODE_S    = S("CD", fontName="Courier", fontSize=8, leading=12, textColor=DARK, backColor=LIGHT_GRAY, leftIndent=10, rightIndent=10, spaceBefore=4, spaceAfter=4)
TAG_CRIT  = S("TC", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=WHITE, backColor=CORAL)
TAG_HIGH  = S("TH", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=DARK, backColor=AMBER)
TAG_MED   = S("TM", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=WHITE, backColor=BLUE)
TAG_LOW   = S("TL", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=WHITE, backColor=MUTED)
SECTION_LABEL = S("SL", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=MUTED, spaceAfter=2, spaceBefore=16)

def hr(): return HRFlowable(width="100%", thickness=0.5, color=LIGHT_GRAY, spaceAfter=10, spaceBefore=4)
def gap(n=8): return Spacer(1, n)

def badge(text, style):
    return Paragraph(f"  {text}  ", style)

def bug_row(bug_id, title, file_ref, problem, fix, severity="critical"):
    sev_map = {"critical": (CORAL, WHITE, "CRITICAL"), "high": (AMBER, DARK, "HIGH"),
               "medium": (BLUE, WHITE, "MEDIUM"), "low": (MUTED, WHITE, "LOW")}
    bg, fg, label = sev_map.get(severity, sev_map["medium"])

    header_style = ParagraphStyle("bh", fontName="Helvetica-Bold", fontSize=10,
                                  leading=14, textColor=WHITE, backColor=bg)
    file_style   = ParagraphStyle("bf", fontName="Courier", fontSize=8,
                                  leading=12, textColor=MUTED)
    body_style   = ParagraphStyle("bb", fontName="Helvetica", fontSize=9,
                                  leading=13, textColor=DARK)
    fix_style    = ParagraphStyle("bfx", fontName="Helvetica-Oblique", fontSize=9,
                                  leading=13, textColor=colors.HexColor("#166534"))

    items = [
        Paragraph(f"{bug_id} -- {title}  [{label}]", header_style),
        gap(3),
        Paragraph(f"File: {file_ref}", file_style),
        gap(2),
        Paragraph(problem, body_style),
        gap(2),
        Paragraph(f"Fix: {fix}", fix_style),
        gap(6),
    ]
    return KeepTogether(items)


def day_block(day, goal, tasks):
    day_style = ParagraphStyle("ds", fontName="Helvetica-Bold", fontSize=11,
                               leading=14, textColor=WHITE, backColor=DARK)
    goal_style = ParagraphStyle("gs", fontName="Helvetica-Oblique", fontSize=10,
                                leading=14, textColor=MUTED, spaceAfter=4)
    task_style = ParagraphStyle("ts", fontName="Helvetica", fontSize=10,
                                leading=14, textColor=DARK, leftIndent=12, spaceAfter=2)

    items = [
        Paragraph(f"  {day}", day_style),
        gap(3),
        Paragraph(f"Goal: {goal}", goal_style),
    ]
    for t in tasks:
        items.append(Paragraph(f"- {t}", task_style))
    items.append(gap(10))
    return KeepTogether(items)


# ── Build ─────────────────────────────────────────────────────────────────────
doc = SimpleDocTemplate(
    OUTPUT_PATH,
    pagesize=letter,
    rightMargin=0.75*inch, leftMargin=0.75*inch,
    topMargin=0.85*inch, bottomMargin=0.75*inch,
)

story = []

# ─── COVER ───────────────────────────────────────────────────────────────────
story += [
    gap(30),
    Paragraph("Content OS", TITLE),
    Paragraph("Planning Document — June 2026", SUBTITLE),
    hr(),
    gap(6),
    Paragraph("Prepared after full codebase audit using graphify knowledge graph (925 nodes, 1,205 edges, 156 communities) + line-by-line senior developer review.", BODY_MUT),
    Paragraph("This document covers: current system state, all 35 confirmed bugs in priority order, and the day-by-day week plan for the next sprint.", BODY_MUT),
    gap(20),
]

# Summary table
summary_data = [
    ["METRIC", "VALUE"],
    ["Total files", "293"],
    ["Code files", "264"],
    ["Doc / research files", "26 + 3 images"],
    ["API routes", "25+"],
    ["Database tables", "12 (0 with RLS)"],
    ["Confirmed bugs", "35"],
    ["Critical / High", "9 Critical + 11 High"],
    ["Live URL", "mm4nbzdu.insforge.site"],
    ["GitHub", "FluentFlier/dispatch"],
    ["Status", "Beta — NOT publicly launched"],
]
summary_table = Table(summary_data, colWidths=[2.5*inch, 4.0*inch])
summary_table.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), DARK),
    ("TEXTCOLOR",  (0,0), (-1,0), WHITE),
    ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",   (0,0), (-1,-1), 9),
    ("FONTNAME",   (0,1), (0,-1), "Helvetica-Bold"),
    ("BACKGROUND", (0,1), (-1,-1), LIGHT_GRAY),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, LIGHT_GRAY]),
    ("GRID",       (0,0), (-1,-1), 0.3, colors.HexColor("#E4E4E7")),
    ("LEFTPADDING", (0,0), (-1,-1), 8),
    ("RIGHTPADDING",(0,0), (-1,-1), 8),
    ("TOPPADDING",  (0,0), (-1,-1), 5),
    ("BOTTOMPADDING",(0,0),(-1,-1), 5),
]))
story += [summary_table, PageBreak()]

# ─── SECTION 1: CURRENT SITUATION ────────────────────────────────────────────
story += [
    Paragraph("SECTION 1", SECTION_LABEL),
    Paragraph("Current System State", H1),
    hr(),
    Paragraph("What Content OS Is", H2),
    Paragraph(
        "Content OS is an AI-powered social media content creation and publishing platform for creators. "
        "Originally built by Anirudh Manjesh as a personal tool, now being productized as a multi-tenant SaaS. "
        "The product is live but not publicly launched. Tagline: Your content engine, trained on you.",
        BODY),
    gap(4),
]

story += [
    Paragraph("The 5-Stage Content Loop", H2),
]
loop_data = [
    ["Stage", "What it does", "Status"],
    ["Signal",   "Mine viral hooks from 80+ creator accounts via GStack/Apify", "Built"],
    ["Draft",    "Claude generates in your voice via Creator Brain RAG + 5-metric evaluator", "Built"],
    ["Publish",  "Multi-platform delivery via Ayrshare (X, LinkedIn, Instagram, Threads)", "Built"],
    ["Reply",    "AI-drafted comment replies, human approval before send", "Built"],
    ["Learn",    "RLML reinforcement from edit feedback improves scoring", "STUB — not wired"],
]
loop_table = Table(loop_data, colWidths=[1.0*inch, 3.8*inch, 1.6*inch])
loop_table.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), DARK),
    ("TEXTCOLOR",  (0,0), (-1,0), WHITE),
    ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",   (0,0), (-1,-1), 9),
    ("FONTNAME",   (0,1), (0,-1), "Helvetica-Bold"),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, LIGHT_GRAY]),
    ("GRID",       (0,0), (-1,-1), 0.3, colors.HexColor("#E4E4E7")),
    ("LEFTPADDING", (0,0), (-1,-1), 7),
    ("RIGHTPADDING",(0,0), (-1,-1), 7),
    ("TOPPADDING",  (0,0), (-1,-1), 4),
    ("BOTTOMPADDING",(0,0),(-1,-1), 4),
    ("TEXTCOLOR",  (2,5), (2,5), CORAL),
    ("FONTNAME",   (2,5), (2,5), "Helvetica-Bold"),
]))
story += [loop_table, gap(10)]

story += [
    Paragraph("What Is Built and Working", H2),
    Paragraph("- Voice Pipeline: draft -> evaluate (5 metrics) -> revise loop -> humanize. Returns voice_match_score + ai_score per generation.", BULLET),
    Paragraph("- Creator Brain: RAG system synced from profile, voice lab, and published posts. Retrieves relevant context at generation time.", BULLET),
    Paragraph("- Voice Lab: 4 API routes (analyze, interview, import, save). Builds vocabulary fingerprint + structural patterns + exportable persona prompt.", BULLET),
    Paragraph("- Hook Intelligence: GStack/Apify mined dataset, scorer, RLML trainer (partially wired), agent-callable tools. Every generation injects top-6 hooks.", BULLET),
    Paragraph("- Publishing: Durable publish_jobs queue, cron every 5 min, Ayrshare multi-platform delivery. Engagement-sync cron every 15 min.", BULLET),
    Paragraph("- Billing: 4 tiers (free/starter/growth/pro), Stripe integration, entitlements enforcement via ai-guard.ts.", BULLET),
    Paragraph("- Calendar: Month/week view, drag-drop scheduling, AI fill-week.", BULLET),
    Paragraph("- Engagement Inbox: Comment sync, AI-drafted replies, approval flow.", BULLET),
    Paragraph("- Multi-tenant Workspaces: workspace + workspace_members tables, active workspace via cookie.", BULLET),
    gap(6),
    Paragraph("What Is NOT Built", H2),
    Paragraph("- Google Calendar OAuth integration (zero code exists)", BULLET),
    Paragraph("- Voice input / audio recording -> post (zero code exists)", BULLET),
    Paragraph("- ElevenLabs voice clone (zero code exists)", BULLET),
    Paragraph("- Email notification system (no sending service wired)", BULLET),
    Paragraph("- Proactive / event-aware content prompting", BULLET),
    Paragraph("- Video auto-edit (stub returning fake data explicitly)", BULLET),
    Paragraph("- Direct OAuth publishing without Ayrshare (direct.ts returns error)", BULLET),
    Paragraph("- Row-Level Security on ANY database table", BULLET),
    gap(6),
    Paragraph("Tech Stack", H2),
]

stack_data = [
    ["Layer", "Technology"],
    ["Frontend / API", "Next.js 14 App Router + TypeScript"],
    ["Backend-as-a-Service", "InsForge (auth, DB, storage, AI gateway, hosting)"],
    ["AI", "Claude Sonnet 4.5 via InsForge AI gateway"],
    ["Publishing", "Ayrshare (X, LinkedIn, Instagram, Threads)"],
    ["Billing", "Stripe (4 tiers: free / starter / growth / pro)"],
    ["Styling", "Tailwind CSS 3.4 (no component library)"],
    ["Video", "Remotion (templates exist, auto-edit is stub)"],
    ["Infra", "Vercel (crons: publish/5min, engage-sync/15min, auto-gen/daily)"],
    ["Voice Cloning (planned)", "ElevenLabs (key available, not integrated)"],
    ["Audio Transcription (planned)", "OpenAI Whisper (key available, not integrated)"],
]
stack_table = Table(stack_data, colWidths=[2.3*inch, 4.1*inch])
stack_table.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), DARK),
    ("TEXTCOLOR",  (0,0), (-1,0), WHITE),
    ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",   (0,0), (-1,-1), 9),
    ("FONTNAME",   (0,1), (0,-1), "Helvetica-Bold"),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, LIGHT_GRAY]),
    ("GRID",       (0,0), (-1,-1), 0.3, colors.HexColor("#E4E4E7")),
    ("LEFTPADDING", (0,0), (-1,-1), 7),
    ("RIGHTPADDING",(0,0), (-1,-1), 7),
    ("TOPPADDING",  (0,0), (-1,-1), 4),
    ("BOTTOMPADDING",(0,0),(-1,-1), 4),
]))
story += [stack_table, PageBreak()]

# ─── SECTION 2: BUGS ─────────────────────────────────────────────────────────
story += [
    Paragraph("SECTION 2", SECTION_LABEL),
    Paragraph("Confirmed Issues — Priority Order", H1),
    hr(),
    Paragraph(
        "35 confirmed bugs across all severity levels found via graphify codebase graph analysis + "
        "line-by-line senior developer audit. Fix Critical + High before ANY new feature work.",
        BODY_MUT),
    gap(6),
]

# ── CRITICAL ─────────────────────────────────────────────────────
story.append(Paragraph("CRITICAL — Fix Before Any Users Touch Production", H2))
story.append(gap(4))

criticals = [
    ("CRIT-A", "Login ?expired=1 CSRF Logout",
     "src/middleware.ts:35",
     "Visiting /login?expired=1 clears the auth cookie without server-side verification. A malicious link or CSRF attack silently logs out any authenticated user.",
     "Remove the ?expired=1 client-driven clear. Handle token expiry server-side in getAuthenticatedUser()."),
    ("CRIT-B", "AI Quota Tracking Is a No-Op Under DB Failure",
     "src/lib/ai-guard.ts:53",
     "incrementUsage().catch(() => {}) swallows every DB error silently. Any InsForge latency spike = quota counter never increments = unlimited free generation.",
     "Log and surface the error. If usage tracking fails, block the request or alert ops."),
    ("CRIT-C", "Auto-Generate Cron Has Zero Per-User Quota Check",
     "src/app/api/cron/auto-generate/route.ts",
     "Runs as admin with no assertCanGenerate() per user. Free plan users with auto_generate_enabled=true get unlimited daily AI on your bill.",
     "Call guardAiRequest(userId) before generating for each user. Skip over-quota users."),
    ("CRIT-D", "Publishes with Expired Tokens After Silent Refresh Failure",
     "src/app/api/publish/route.ts:82-104",
     "ensureFreshToken() catches refresh errors and falls through. Expired token sent to Ayrshare. Platform rejects it. No log indicating the token was stale.",
     "Throw on refresh failure. Return token_expired error. Never fall through to publish with a known-bad token."),
    ("CRIT-E", "Undefined Session Token May Disable InsForge RLS",
     "src/lib/insforge/server.ts:39,45",
     "If sessionToken is missing from cookies, edgeFunctionToken is undefined. Passing undefined to InsForge SDK may silently disable row filtering — potential elevated access.",
     "Return 401 before constructing the client if sessionToken is undefined on any protected route."),
    ("BUG-01", "Race Condition on Usage Counter — Plan Limits Bypassable",
     "src/lib/usage.ts:20-53",
     "SELECT-then-UPDATE pattern (no atomic lock). Concurrent rapid-click requests both read same count, both pass limit, both write count+1 instead of count+2. Users bypass monthly cap ~2x under burst.",
     "DB-level atomic increment via Postgres RPC. No SELECT-then-UPDATE."),
    ("BUG-02", "Burst Store Is Per-Process Memory — Ineffective on Serverless",
     "src/lib/ai-guard.ts:13",
     "burstStore is an in-memory Map. Each cold start gets a fresh Map. Any user who triggers a cold start bypasses the 15 req/60s burst guard entirely.",
     "Replace with Redis/Upstash sliding window counter, or remove and document the monthly DB cap is the only real ceiling."),
    ("BUG-03", "Stripe Metadata Fallback Gives Away Paid Plan Free",
     "src/lib/stripe-webhook.ts:28-32",
     "If metadata.plan is missing or invalid, falls back to 'starter' (paid) instead of 'free'. Misconfigured Stripe product = every subscriber gets starter for free.",
     "Fall back to 'free'. Log + alert when the fallback fires."),
    ("BUG-04", "OAuth Tokens Stored Plaintext on Non-Vercel Deploys",
     "src/lib/crypto.ts:44-51",
     "Missing TOKEN_ENCRYPTION_KEY + non-Vercel host (Railway, Render, Fly.io) = plaintext token stored in DB. No error, no log.",
     "Require explicit ALLOW_PLAINTEXT_TOKENS=1 for dev only. Any missing key in non-localhost context must throw."),
]
for args in criticals:
    story.append(bug_row(*args, severity="critical"))

story += [gap(4), Paragraph("HIGH — Fix Before Public Launch", H2), gap(4)]

highs = [
    ("BUG-05", "Double AI Usage Charge Per Generation",
     "src/app/api/generate/route.ts:25-35",
     "usage.track() charges 1 unit. guardAiRequest() charges another 1 unit internally. 2 units per generation. Users hit plan limits at half their actual quota.",
     "Remove usage.track() at route level. Use only guardAiRequest() for usage tracking."),
    ("BUG-06", "RL Supervisor Stub Returns False 'Cycle Complete'",
     "src/lib/hooks-intelligence/supervisor-agent.ts:40-51",
     "Generate node is commented out. runTrainingStep([], []) called with empty arrays — no learning happens. Returns status: 'cycle-complete' and usageTracked: true. The intelligence engine is a facade.",
     "Either wire the generate node or return an honest stub status. Never charge usage for nothing."),
    ("BUG-07", "Engagement Inbox Sort Comparator Operator Precedence Bug",
     "src/lib/engagement/inbox.ts:181",
     "?? 0 is on the entire localeCompare expression, not just the optional chain. If synced_at is undefined on either side, sort silently returns 0 treating unequal items as equal.",
     "Extract dates to variables first, then call localeCompare with a safe empty string fallback."),
    ("BUG-08", "Auto-Optimize Background Fetch Uses Session Cookies",
     "src/lib/auto-optimize.ts:64-78",
     "Fire-and-forget fetch to /api/optimize passes original request cookies. On serverless, by the time it fires the session may be expired -> 401, silent failure.",
     "Use service-key-authenticated internal call or restructure as a job queue entry."),
    ("BUG-09", "UsageTracker.track() Never Actually Blocks",
     "src/lib/hooks-intelligence/usage-tracker.ts:62-65",
     "JSDoc says it enforces limits. All errors caught and returned as {allowed: true}. Enforcement does not exist. It is logging-only.",
     "Update JSDoc to reflect reality, or implement real enforcement via assertCanGenerate()."),
    ("BUG-10", "Direct-Mode Publish Jobs Stuck in processing Forever",
     "src/lib/publish-queue.ts:127-133",
     "Direct mode returns failed object without updating DB row. Row stays processing. Next cron skips it. Job is a zombie — never retried, never resolved.",
     "Update DB row to 'failed' before returning in the direct-mode branch."),
    ("BUG-11", "No Dead-Letter / Stuck-Processing Timeout on Publish Jobs",
     "src/lib/publish-queue.ts:210-222",
     "Cron sets job to processing. Serverless function times out. Job stuck in processing forever with no recovery mechanism.",
     "Any job in processing for >10 min resets to failed or dead."),
    ("BUG-24", "processPublishJob Not Awaited in Publish Cron",
     "src/app/api/cron/publish/route.ts:46",
     "Fire-and-forget call. Cron moves to next job before previous resolves. Status updates race. Results array reports incorrect counts.",
     "Properly await every processPublishJob call before continuing the loop."),
    ("BUG-25", "incrementUsage Not Awaited on Scheduled Publish Path",
     "src/app/api/publish/route.ts:256 vs 417",
     "Scheduled path: fire-and-forget. Direct path: awaited. Scheduled publishes silently fail to log usage.",
     "Await incrementUsage on all code paths consistently."),
    ("BUG-26", "Publish Job attempts Counter Off-by-One",
     "src/lib/publish-queue.ts:136-150,194",
     "attempts incremented in two places. Job that fails once shows attempts: 2. max_attempts: 3 hit after only 2 real tries. One retry wasted per job.",
     "Increment attempts in exactly one place — at job pickup, not at failure."),
    ("BUG-27", "ayrshare.listAccounts() Silent Empty Return on Any API Error",
     "src/lib/social/ayrshare.ts:88-94",
     "Any Ayrshare error -> silent empty array. UI shows no connected accounts. Real cause (outage, revoked key) completely hidden. Zero logging.",
     "Log the error with context. Distinguish no accounts from API error in return type."),
    ("BUG-28", "decryptByokCredentials Throws Uncaught on Malformed JSON",
     "src/app/api/publish/route.ts:379",
     "JSON.parse inside decryptByokCredentials has no try/catch. Corrupted BYOK in DB -> unhandled exception -> 500 with no useful message.",
     "Wrap in try/catch. Return {error: 'credential_corrupted'}."),
    ("BUG-29", "Brain Sync JSON.parse Uncaught — Sync Silently Aborts",
     "src/lib/brain/sync.ts:92",
     "JSON.parse(profile.content_pillars) on malformed data throws uncaught. syncBrainFromProfile() crashes mid-execution. Brain never updates. Voice context degrades silently.",
     "Wrap parse in try/catch. Use empty array default on failure. Log warning."),
    ("BUG-30", "Auto-Generate Cron Day-of-Week Has No Timezone Handling",
     "src/app/api/cron/auto-generate/route.ts:63",
     "Day-of-week uses server UTC. Creator in PST with Monday schedule gets Monday post generated Sunday night their time.",
     "Store user timezone in user_settings. Convert now() to user local time before day-of-week check."),
    ("BUG-31", "Active Workspace Chosen from Unvalidated Cookie Value",
     "src/lib/workspace.ts:53",
     "Cookie value used directly without validating it exists in user's workspace list. Potential cross-workspace data access if IDs are guessable.",
     "Verify cookie value exists in user's workspaceIds set. Default to first workspace if invalid."),
]
for args in highs:
    story.append(bug_row(*args, severity="high"))

story += [gap(4), Paragraph("MEDIUM — Fix in Parallel with New Features", H2), gap(4)]

mediums = [
    ("BUG-12", "undefined as any Type Bypass in Voice Pipeline",
     "src/lib/voice-pipeline.ts:53",
     "getBestHooksForContext(undefined as any, 6). The function already accepts undefined. Cast hides future API changes.",
     "Change to getBestHooksForContext(undefined, 6)."),
    ("BUG-13", "require('fs') Inside Function Body — Serverless Incompatible",
     "src/lib/hooks-intelligence/index.ts:36-44",
     "require('fs') inside function body. Edge runtime = silent failure. Try-catch swallows it. In-memory updates lost on instance restart.",
     "Move to Node.js-only module with export const runtime = 'nodejs' or remove file persistence."),
    ("BUG-14", "decryptToken Silent Fallback on Corrupted Tokens",
     "src/lib/crypto.ts:82-84",
     "Malformed token (not 3 colon-separated parts) returns raw input as-is. Corrupted token used as real API key -> confusing downstream auth failures.",
     "Throw descriptive error when format is wrong. Log so ops can detect."),
    ("BUG-15", "Evaluator Fallback Matrix Triggers Retry Loop on API Error",
     "src/lib/voice-evaluator.ts:68-77",
     "AI call fails -> fallback sets pass: false, ai_slop: 4 -> pipeline sees failed evaluation -> runs revision loop -> another AI call -> likely fails again. One error = 3x token spend.",
     "Set fallback pass: true to prevent unnecessary retries on infra errors."),
    ("BUG-16", "Subscription Insert Race on New User",
     "src/lib/entitlements.ts:79-87",
     "Plain INSERT for free tier row. Concurrent requests from new user = unique constraint violation, silent failure, no subscription row.",
     "Use INSERT ... ON CONFLICT DO NOTHING (upsert)."),
    ("BUG-17", "listWorkspaces Fetches ALL Workspaces from All Users Then Filters in JS",
     "src/lib/workspace.ts:38-46",
     "No .in('id', userWorkspaceIds) on DB query. Every workspace from every user comes back. Privacy issue + performance bomb at scale.",
     "Add .in('id', Array.from(ids)) to the DB query to filter server-side."),
    ("BUG-18", "variant_group_id Written Before Variants Confirmed",
     "src/lib/auto-optimize.ts:52-61",
     "Source post gets variant_group_id before optimize call. If optimize fails -> orphaned source post with variant_group_id pointing to nothing.",
     "Only update variant_group_id after variants are successfully created."),
    ("BUG-32", "syncBrainWins Runs on Every Post Sync — N+1 Query",
     "src/lib/brain/sync.ts:174",
     "syncBrainWins() called inside every syncBrainPublishedPost(). Publishing 10 posts triggers 10 full top-5 queries.",
     "Call syncBrainWins() once after all posts are synced, not per-post."),
]
for args in mediums:
    story.append(bug_row(*args, severity="medium"))

story += [gap(4), Paragraph("LOW / GOOD TO HAVE", H2), gap(4)]

lows = [
    ("BUG-19", "rate-limit.ts Is Dead Code",
     "src/lib/rate-limit.ts",
     "checkRateLimit() and recordRateLimitHit() are not imported by any route. All routes use ai-guard.ts. Creates a third potential double-charge path if ever imported accidentally.",
     "Delete the file. It is unused."),
    ("BUG-21", "Stripe Webhook Missing invoice.payment_failed Handler",
     "src/lib/stripe-webhook.ts:51,80",
     "invoice.payment_failed not handled. Subscriptions go past_due without Dispatch knowing. Users keep generating past due date.",
     "Add invoice.payment_failed -> set status to past_due and restrict access."),
    ("BUG-22", "Stripe Webhook Accepts Replayed Requests",
     "src/lib/stripe-webhook.ts:7-25",
     "Timestamp extracted from header but never validated against Date.now(). Replay attacks accepted indefinitely.",
     "Reject if |now - webhook_timestamp| > 300 seconds."),
    ("BUG-23", "x-pathname Header Dependency Breaks if Middleware Changes",
     "src/app/(dashboard)/layout.tsx:14-15",
     "headers().get('x-pathname') only works because middleware injects it. Remove middleware or upgrade to Next.js 15 -> layout always sees '' -> teleprompter/onboarding redirects break.",
     "Use usePathname() client-side or pass as a search param instead."),
    ("BUG-33", "publish_jobs Missing Index on (user_id, status, created_at)",
     "db/schema.sql:296",
     "Index exists on (status, scheduled_for) for cron. UI queries by user_id + status — full table scan as publish_jobs grows.",
     "Add index on (user_id, status, created_at desc)."),
    ("BUG-34", "Workspace Members Select Non-Deterministic Sort",
     "src/lib/workspace.ts:42",
     "workspace_members query has no ORDER BY. Same user sees workspace list in different order on different requests.",
     "Add .order('created_at', {ascending: true}) to the select."),
    ("SCHEMA", "Zero RLS Policies on All 12 Tables",
     "db/schema.sql",
     "Every table has user_id but zero CREATE POLICY statements. All isolation is application-level. One missed .eq('user_id') filter = full data leak.",
     "Add RLS policies for all tables before any real multi-user production traffic."),
]
for id_, title, file_, problem, fix in lows:
    story.append(bug_row(id_, title, file_, problem, fix, severity="low"))

story.append(PageBreak())

# ─── SECTION 3: WEEK PLAN ────────────────────────────────────────────────────
story += [
    Paragraph("SECTION 3", SECTION_LABEL),
    Paragraph("Week Plan — Sprint 1", H1),
    hr(),
    Paragraph(
        "Approach: Mix of A (Google Calendar integration) + B (Voice input via Whisper + ElevenLabs). "
        "Start with the Experience Log conversational loop (no external dependencies) to validate the core insight, "
        "then layer in voice input and calendar integration on top.",
        BODY_MUT),
    gap(8),
    Paragraph("The Core Feature Being Built", H2),
    Paragraph(
        "A creator attends an event (NVIDIA meet, YC demo day, conference). They open Content OS, "
        "type the event name (or it appears from their Google Calendar). Content OS uses Claude's knowledge "
        "to generate 5 targeted smart questions about that specific event. The creator answers by typing OR "
        "by tapping a mic button and speaking (both co-exist, same output). Content OS generates "
        "platform-specific drafts (LinkedIn professional, X punchy thread, Threads conversational, Instagram) "
        "-- all voice-matched via the existing voice pipeline. ElevenLabs voice clone runs as an optional audio layer.",
        BODY),
    gap(8),
    Paragraph("Decisions Locked", H2),
]

decisions_data = [
    ["Decision", "Choice", "Rationale"],
    ["Calendar", "Google Calendar OAuth", "90% of use case. Outlook in v2."],
    ["Email nudge", "Gmail first, Resend fallback", "Zero new service needed if Gmail works"],
    ["Event research", "Claude knowledge first", "Works for major public events. Web search API (Tavily) in v2 for obscure events."],
    ["Audio transcription", "OpenAI Whisper API", "Key available. $0.006/min. Best quality."],
    ["Voice clone", "ElevenLabs", "Key available. Trained from Voice Lab samples."],
    ["Voice input position", "Optional co-exists with text", "Mic button alongside every text answer field. Same output path."],
    ["Bug fixes", "Critical + High first", "Fix security + billing leaks before building new surface."],
]
decisions_table = Table(decisions_data, colWidths=[1.5*inch, 1.8*inch, 3.1*inch])
decisions_table.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), DARK),
    ("TEXTCOLOR",  (0,0), (-1,0), WHITE),
    ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",   (0,0), (-1,-1), 9),
    ("FONTNAME",   (0,1), (0,-1), "Helvetica-Bold"),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, LIGHT_GRAY]),
    ("GRID",       (0,0), (-1,-1), 0.3, colors.HexColor("#E4E4E7")),
    ("LEFTPADDING", (0,0), (-1,-1), 7),
    ("RIGHTPADDING",(0,0), (-1,-1), 7),
    ("TOPPADDING",  (0,0), (-1,-1), 4),
    ("BOTTOMPADDING",(0,0),(-1,-1), 4),
    ("VALIGN", (0,0), (-1,-1), "TOP"),
]))
story += [decisions_table, gap(12)]

story.append(Paragraph("Day-by-Day Plan", H2))
story.append(gap(6))

story.append(day_block(
    "Day 1 (Monday) — Bug Fixes: Critical Security Tier",
    "Close the 5 critical security gaps before touching any new code.",
    [
        "Fix CRIT-A: Remove ?expired=1 client-driven token clear from middleware.ts",
        "Fix CRIT-B: Replace incrementUsage().catch(() => {}) with real error handling + alerting",
        "Fix CRIT-C: Add guardAiRequest(userId) per-user check in auto-generate cron",
        "Fix CRIT-D: Throw on token refresh failure in publish route, no silent fallthrough",
        "Fix CRIT-E: Return 401 before constructing InsForge client if sessionToken is undefined",
        "Fix BUG-03: Change Stripe planFromMetadata fallback from 'starter' to 'free'",
        "Fix BUG-22: Add Stripe webhook timestamp validation (reject if >300s old)",
        "Run: npm run build + npm run lint. Zero errors before moving to Day 2.",
    ]
))

story.append(day_block(
    "Day 2 (Tuesday) — Bug Fixes: Billing + Publish Pipeline",
    "Fix the broken core flows that affect every user every day.",
    [
        "Fix BUG-01: Replace SELECT-then-UPDATE with atomic DB increment in usage.ts",
        "Fix BUG-05: Remove duplicate usage.track() call in generate/route.ts",
        "Fix BUG-10: Update publish_jobs DB row to 'failed' in direct-mode branch",
        "Fix BUG-11: Add stuck-processing timeout (>10 min in processing -> reset to failed)",
        "Fix BUG-24: Await processPublishJob properly in publish cron loop",
        "Fix BUG-25: Await incrementUsage on scheduled publish path consistently",
        "Fix BUG-26: Increment attempts in exactly one place in publish queue",
        "Fix BUG-17: Add .in('id', ids) to listWorkspaces DB query (privacy + perf)",
        "Run: npm run build. Verify publish cron returns correct results in staging.",
    ]
))

story.append(day_block(
    "Day 3 (Wednesday) — Experience Log: Backend",
    "Build the 3 API routes for the experience-capture conversational loop.",
    [
        "Build POST /api/experience/research: event name -> Claude knowledge extraction -> returns {event_summary, key_people, key_announcements}",
        "Build POST /api/experience/questions: event context + creator profile -> 5 targeted specific questions (not generic)",
        "Build POST /api/experience/draft: answers array + event context -> calls generateWithVoicePipeline per platform -> returns {linkedin, twitter_thread[], threads, instagram}",
        "The question prompt is the IP: questions must reference specific event details (speakers, products announced), not be generic",
        "Test all 3 routes via API client with a real event (e.g., NVIDIA GTC, YC Demo Day)",
        "Verify voice_match_score > 70% on generated drafts",
    ]
))

story.append(day_block(
    "Day 4 (Thursday) — Experience Log: UI + Whisper Voice Input",
    "Build the ExperienceLogModal + wire Whisper transcription as optional alongside text.",
    [
        "Build ExperienceLogModal.tsx: Step 1 (event name input) -> Step 2 (event summary confirm) -> Step 3 (5 Q&A with mic button option) -> Step 4 (4 platform draft tabs) -> Step 5 (save/schedule/publish)",
        "Add 'Log Experience' to dashboard quick-actions and as a tab in Generate page",
        "Build POST /api/transcribe: accepts audio blob -> Whisper API -> returns {transcript}",
        "Build RecordButton.tsx: holds MediaRecorder, sends blob to /api/transcribe on release, populates answer textarea",
        "Mic button co-exists with text textarea: user can type OR speak, same output path",
        "Handle: microphone permission denied, mobile Safari MediaRecorder quirks, max 60s recording",
        "Wire Whisper transcript into the answer field with a 'spoken transcript' note for voice pipeline",
    ]
))

story.append(day_block(
    "Day 5 (Friday) — Google Calendar OAuth + ElevenLabs + Integration Polish",
    "Wire calendar so the tool knows about events proactively. Add ElevenLabs voice layer.",
    [
        "Google Calendar OAuth: register Google Cloud app, add OAuth callback at /api/auth/google-calendar, store token in social_accounts with platform='google_calendar'",
        "Build GET /api/calendar/events: reads next 7 days of Google Calendar events, returns {id, title, start, end, description, attendees}",
        "Dashboard card: 'Upcoming events' -- shows next 3 calendar events, each with 'Log Experience' button pre-filled with event name",
        "ElevenLabs: POST /api/voice/clone -> pulls Voice Lab sample posts audio -> creates ElevenLabs voice model -> stores voice_id in user_settings",
        "Wire voice_id into experience drafts: offer 'Generate Audio Version' button that sends draft text to ElevenLabs -> returns audio URL",
        "End-to-end smoke test: Google Calendar event -> auto-appears on dashboard -> click Log Experience -> answer 3 questions (1 typed, 2 spoken) -> get 4 platform drafts -> verify voice match > 70% -> save to library",
        "Mobile test at 390px. Mic button must work on iOS Safari.",
    ]
))

story += [
    gap(8),
    Paragraph("Week 2 Preview (Not This Sprint)", H2),
]

w2_data = [
    ["Feature", "Why Week 2"],
    ["Email nudge after event", "Depends on calendar integration (Week 1) being stable first"],
    ["ElevenLabs deeper integration (text-to-audio for all posts)", "Week 1 proves voice clone works, Week 2 makes it a first-class feature"],
    ["Fix remaining Medium bugs (BUG-12 through BUG-18)", "Not blocking new feature. Fix in parallel with Week 2 features."],
    ["Add RLS policies to all 12 tables", "Requires careful per-table policy design. Dedicated security sprint."],
    ["Tavily/Perplexity web search for obscure event research", "Claude knowledge covers major events. Add search when needed."],
]
w2_table = Table(w2_data, colWidths=[2.5*inch, 4.0*inch])
w2_table.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), SURFACE),
    ("TEXTCOLOR",  (0,0), (-1,0), WHITE),
    ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",   (0,0), (-1,-1), 9),
    ("FONTNAME",   (0,1), (0,-1), "Helvetica-Bold"),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, LIGHT_GRAY]),
    ("GRID",       (0,0), (-1,-1), 0.3, colors.HexColor("#E4E4E7")),
    ("LEFTPADDING", (0,0), (-1,-1), 7),
    ("RIGHTPADDING",(0,0), (-1,-1), 7),
    ("TOPPADDING",  (0,0), (-1,-1), 4),
    ("BOTTOMPADDING",(0,0),(-1,-1), 4),
    ("VALIGN", (0,0), (-1,-1), "TOP"),
]))
story += [w2_table, gap(16)]

# ─── FOOTER SUMMARY ──────────────────────────────────────────────────────────
story += [
    hr(),
    Paragraph("TL;DR", H2),
    Paragraph("Content OS has a sophisticated AI voice pipeline and a solid publishing infrastructure. The codebase is architecturally mature for a solo build. The problems are: (1) 9 critical security and billing bugs that need closing before any real users touch production, (2) a completely missing RLS layer at the database, and (3) the core differentiating new feature -- proactive event-aware content capture with voice input -- has zero code yet. This sprint closes the critical bugs first (Day 1-2), then builds the experience-capture loop with Whisper voice input and Google Calendar integration (Day 3-5). By end of week: creators can see their upcoming calendar events, tap 'Log Experience', answer 5 smart questions by typing or speaking, and get platform-specific posts in their voice within 2 minutes.", BODY),
    gap(6),
    Paragraph("Generated by Content OS Planning Session -- June 2026", BODY_MUT),
]

doc.build(story)
print(f"PDF written: {os.path.abspath(OUTPUT_PATH)}")
