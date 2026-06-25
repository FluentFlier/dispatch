"""
Content OS -- Planning Meeting Questionnaire PDF
Run: python scripts/generate_questions_pdf.py
Output: docs/content-os-meeting-questions-jun2026.pdf
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, PageBreak
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER
import os

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "content-os-meeting-questions-jun2026.pdf")
os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

# Colors
DARK       = colors.HexColor("#09090B")
SURFACE    = colors.HexColor("#18181B")
CORAL      = colors.HexColor("#EB5E55")
AMBER      = colors.HexColor("#F59E0B")
GREEN      = colors.HexColor("#22C55E")
BLUE       = colors.HexColor("#3B82F6")
MUTED      = colors.HexColor("#71717A")
WHITE      = colors.white
LIGHT_GRAY = colors.HexColor("#F4F4F5")
COMP_BG    = colors.HexColor("#EFF6FF")
REC_BG     = colors.HexColor("#F0FDF4")

def S(name, **kw): return ParagraphStyle(name, **kw)

TITLE     = S("T",  fontName="Helvetica-Bold", fontSize=26, leading=32, textColor=DARK, spaceAfter=4)
SUBTITLE  = S("ST", fontName="Helvetica",      fontSize=12, leading=17, textColor=MUTED, spaceAfter=18)
CAT_HDR   = S("CH", fontName="Helvetica-Bold", fontSize=14, leading=19, textColor=WHITE, spaceAfter=0)
Q_NUM     = S("QN", fontName="Helvetica-Bold", fontSize=11, leading=15, textColor=CORAL, spaceAfter=2, spaceBefore=14)
Q_TEXT    = S("QT", fontName="Helvetica-Bold", fontSize=11, leading=15, textColor=DARK, spaceAfter=4)
BODY      = S("BD", fontName="Helvetica",      fontSize=10, leading=15, textColor=DARK, spaceAfter=4)
BODY_MUT  = S("BM", fontName="Helvetica",      fontSize=9,  leading=14, textColor=MUTED, spaceAfter=3)
OPT       = S("OP", fontName="Helvetica",      fontSize=10, leading=14, textColor=DARK, leftIndent=14, spaceAfter=2)
COMP_HDR  = S("CM", fontName="Helvetica-Bold", fontSize=9,  leading=13, textColor=BLUE, spaceAfter=2, spaceBefore=6)
COMP_BODY = S("CB", fontName="Helvetica",      fontSize=9,  leading=13, textColor=colors.HexColor("#1E40AF"), spaceAfter=2, backColor=COMP_BG, leftIndent=10, rightIndent=10)
REC_HDR   = S("RH", fontName="Helvetica-Bold", fontSize=9,  leading=13, textColor=colors.HexColor("#166534"), spaceAfter=2, spaceBefore=4)
REC_BODY  = S("RB", fontName="Helvetica-Oblique", fontSize=9, leading=13, textColor=colors.HexColor("#166534"), backColor=REC_BG, leftIndent=10, rightIndent=10, spaceAfter=6)
ORDER_S   = S("OS", fontName="Courier",        fontSize=9,  leading=14, textColor=DARK, backColor=LIGHT_GRAY, leftIndent=10, rightIndent=10, spaceAfter=3)
SECTION_L = S("SL", fontName="Helvetica-Bold", fontSize=8,  leading=12, textColor=MUTED, spaceAfter=2, spaceBefore=16)

def hr(): return HRFlowable(width="100%", thickness=0.5, color=LIGHT_GRAY, spaceAfter=8, spaceBefore=2)
def gap(n=6): return Spacer(1, n)

def cat_header(num, title, subtitle):
    tbl = Table([[Paragraph(f"Category {num}: {title}", CAT_HDR)]], colWidths=[6.5*inch])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), DARK),
        ("LEFTPADDING",  (0,0), (-1,-1), 12),
        ("RIGHTPADDING", (0,0), (-1,-1), 12),
        ("TOPPADDING",   (0,0), (-1,-1), 8),
        ("BOTTOMPADDING",(0,0), (-1,-1), 8),
    ]))
    return KeepTogether([tbl, gap(4), Paragraph(subtitle, BODY_MUT), gap(4)])

def question(num, title, body_lines, options, comp_text, rec_text):
    items = []
    items.append(Paragraph(f"Q{num}", Q_NUM))
    items.append(Paragraph(title, Q_TEXT))
    for line in body_lines:
        items.append(Paragraph(line, BODY))
    for opt in options:
        items.append(Paragraph(opt, OPT))
    if comp_text:
        items.append(Paragraph("Competitor Reference", COMP_HDR))
        items.append(Paragraph(comp_text, COMP_BODY))
    if rec_text:
        items.append(Paragraph("Recommendation", REC_HDR))
        items.append(Paragraph(rec_text, REC_BODY))
    items.append(hr())
    return KeepTogether(items)

doc = SimpleDocTemplate(
    OUTPUT_PATH,
    pagesize=letter,
    rightMargin=0.75*inch, leftMargin=0.75*inch,
    topMargin=0.85*inch,   bottomMargin=0.75*inch,
)

story = []

# Cover
story += [
    gap(24),
    Paragraph("Content OS", TITLE),
    Paragraph("Planning Meeting -- Full Questionnaire", SUBTITLE),
    Paragraph("June 2026  |  30 Questions  |  10 Categories", BODY_MUT),
    gap(6),
    hr(),
    gap(4),
    Paragraph(
        "Answer questions in category order. Answers to early categories unlock the right framing for later ones. "
        "Aim to lock Categories 1 to 5 (Q1 to Q13) in tonight's session. "
        "Competitor references are included so you have a benchmark before choosing a direction.",
        BODY),
    gap(6),
]

# Order of meeting table
order_data = [
    ["Session order", "Category", "Questions"],
    ["Start here",    "1 -- Who is this for",         "Q1 to Q4"],
    ["",              "2 -- Value proposition",        "Q5 to Q6"],
    ["",              "3 -- Experience capture",       "Q7 to Q10"],
    ["",              "4 -- Voice system",             "Q11 to Q13"],
    ["Tonight target","5 -- Voice input (audio)",      "Q14 to Q16"],
    ["",              "6 -- Calendar integration",     "Q17 to Q19"],
    ["",              "7 -- Publishing strategy",      "Q20 to Q21"],
    ["",              "8 -- Pricing and business",     "Q22 to Q24"],
    ["",              "9 -- Technical checks",         "Q25 to Q28"],
    ["End here",      "10 -- Growth and distribution", "Q29 to Q30"],
]
order_table = Table(order_data, colWidths=[1.2*inch, 3.3*inch, 1.5*inch])
order_table.setStyle(TableStyle([
    ("BACKGROUND",    (0,0), (-1,0), DARK),
    ("TEXTCOLOR",     (0,0), (-1,0), WHITE),
    ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",      (0,0), (-1,-1), 9),
    ("FONTNAME",      (0,1), (0,-1), "Helvetica-Bold"),
    ("ROWBACKGROUNDS",(0,1), (-1,-1), [WHITE, LIGHT_GRAY]),
    ("GRID",          (0,0), (-1,-1), 0.3, colors.HexColor("#E4E4E7")),
    ("LEFTPADDING",   (0,0), (-1,-1), 8),
    ("RIGHTPADDING",  (0,0), (-1,-1), 8),
    ("TOPPADDING",    (0,0), (-1,-1), 4),
    ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ("TEXTCOLOR",     (0,1), (0,1), CORAL),
    ("TEXTCOLOR",     (0,5), (0,5), BLUE),
    ("TEXTCOLOR",     (0,10),(0,10), colors.HexColor("#166534")),
    ("FONTNAME",      (0,1), (0,1), "Helvetica-Bold"),
    ("FONTNAME",      (0,5), (0,5), "Helvetica-Bold"),
    ("FONTNAME",      (0,10),(0,10),"Helvetica-Bold"),
]))
story += [order_table, PageBreak()]

# ─────────────────────────────────────────────────────────
# CATEGORY 1
# ─────────────────────────────────────────────────────────
story.append(cat_header(1, "Who Is This For",
    "Lock the user persona first. Every feature decision changes based on this answer."))

story.append(question(
    1,
    "Solo tool or multi-user product?",
    ["The codebase has multi-tenant workspaces, Stripe billing, team seats. The original PRD was single user, private, no registration, built for Anirudh. Which direction are we actually committing to?"],
    [],
    "Taplio started LinkedIn-only, solo-founder focused. They added team features after PMF. FeedHive started solo, added agency tier after. VoiceMoat is strictly personal brand solo. Lately.ai went enterprise-first and got stuck at high price points most creators cannot afford.",
    "Start solo and personal brand. Add agency workspace as a paid upgrade, not a core feature. Ship one persona deeply before expanding."
))

story.append(question(
    2,
    "Who exactly is the primary user persona?",
    ["Pick one to design around."],
    [
        "Option A -- Founder building personal brand on LinkedIn and X (the Anirudh persona)",
        "Option B -- Creator with existing audience (10K+ followers, posts daily)",
        "Option C -- Agency managing content for multiple clients",
    ],
    "No direct comparison -- no competitor clearly targets all three at once and does it well.",
    "Option A is the clearest persona and matches the existing codebase voice system. Build around this. Option C comes later via the workspace feature."
))

story.append(question(
    3,
    "What is the user's current weekly posting frequency before using Content OS?",
    ["The answer tells you what problem you are actually solving."],
    [
        "0 to 1 posts per week -- activation problem, need to teach them to post",
        "2 to 4 posts per week -- workflow problem, need to make it faster",
        "5 or more posts per week -- quality problem, need to make content better",
    ],
    "Castmagic and Lately.ai target high-volume users (5+ posts). Buffer targets 0 to 2 post people. Content OS voice pipeline and hook intelligence only show value if the user posts enough to have a voice to match.",
    "Target the 2 to 4 posts per week user. High enough to have a voice, low enough to feel the friction of creating content."
))

story.append(question(
    4,
    "What does the user currently use before Content OS?",
    ["The real competition is not VoiceMoat or Taplio. It is the free alternative the user already has."],
    [
        "Option A -- ChatGPT plus Buffer free tier (most common, costs zero)",
        "Option B -- Notion for planning, then manual posting",
        "Option C -- Nothing, starts fresh with Content OS",
    ],
    "Most creators' actual alternative is a blank ChatGPT tab plus Buffer free. Combined cost: zero.",
    "Content OS must be demonstrably better than ChatGPT plus Buffer in under 10 minutes of first use. If you cannot show that immediately, you lose them."
))

story.append(PageBreak())

# ─────────────────────────────────────────────────────────
# CATEGORY 2
# ─────────────────────────────────────────────────────────
story.append(cat_header(2, "Core Value Proposition",
    "What is the one reason someone pays for this instead of a free alternative?"))

story.append(question(
    5,
    "Which is the primary hook -- experience capture, voice matching, or publishing?",
    ["Pick one. The product looks very different depending on which one leads."],
    [
        "Option A -- Experience capture: Turn your real moments into posts before you forget them (the NVIDIA event concept)",
        "Option B -- Voice matching: AI that writes exactly like you, every time (VoiceMoat's angle)",
        "Option C -- Full pipeline: From idea to published post in one place (Buffer and FeedHive's angle)",
    ],
    "VoiceMoat went all-in on B and built a loyal niche at $25 to $100 per month. Buffer went all-in on C and got stuck at 25M ARR for years. Nobody has done A yet. Castmagic is closest but their product is audio to content batch, not event to platform-specific voice-matched post.",
    "A is the most differentiated. B is the moat that proves it. C is the commodity. Build around A with B as the proof it works."
))

story.append(question(
    6,
    "What is your single-sentence pitch?",
    [
        "Before the meeting ends, agree on one sentence that explains Content OS to someone who has never heard of it.",
        "Test: if a random founder can repeat it back without notes 10 minutes later, it works.",
    ],
    [],
    "Buffer: Simpler social media tools for authentic brands. VoiceMoat: Your voice is your moat. Castmagic: 10x audio content with AI. Taplio: Grow on LinkedIn with AI. None of these are truly memorable.",
    "The best unclaimed angle: The tool that turns what you lived today into what you post tomorrow. Or shorter: Content OS -- your life, published."
))

story.append(PageBreak())

# ─────────────────────────────────────────────────────────
# CATEGORY 3
# ─────────────────────────────────────────────────────────
story.append(cat_header(3, "Experience Capture Feature",
    "The new feature being built this sprint. Lock these before Day 3 of development."))

story.append(question(
    7,
    "Where does the user trigger Log an Experience -- phone or desktop?",
    [
        "The NVIDIA event scenario means the user is away from their desk. Mobile is primary for capture. Desktop is primary for editing.",
        "Does the full flow need to work on mobile at capture time?",
    ],
    [],
    "Castmagic solved this with an iOS app that records directly. Their edge: record on a walk, get content batch when you get home. Content OS is web-only currently.",
    "Mobile web is enough for sprint 1. The voice input (mic button) makes mobile capture fast even without a native app. Native app is a month 3 decision."
))

story.append(question(
    8,
    "How many questions does the experience interview have and who generates them?",
    ["This is the core IP of the feature. Generic questions produce generic answers."],
    [
        "Option A -- Fixed 5 questions Claude generates from event context (shippable in sprint 1)",
        "Option B -- Adaptive questions, Claude asks follow-ups based on prior answers (more powerful)",
        "Option C -- User picks from a pre-built question bank",
    ],
    "No competitor does event-specific AI interview questions. Otter.ai does real-time AI follow-up in meetings but not for content creation.",
    "Option A for sprint 1. The questions must reference specific event details (not generic). Adaptive (B) in sprint 2 once you know which question types get the best answers."
))

story.append(question(
    9,
    "What is the minimum viable input for the feature to work?",
    ["How much does the user need to provide before Content OS can generate useful questions?"],
    [
        "Option A -- Just the event name (NVIDIA GTC 2026), Claude figures out context from training knowledge",
        "Option B -- Event name plus one sentence about what happened",
        "Option C -- Full calendar event with title, description, and attendees",
    ],
    "Option A works for major public events. Fails for private meetings (coffee with Sarah the VC). Option C is the full vision but Day 5 of the sprint.",
    "Option B for sprint 1. Works for all event types. Option A as a shortcut for well-known events. Option C when calendar integration is live."
))

story.append(question(
    10,
    "How many platforms do we generate for and in what order?",
    [
        "Generating for all 4 platforms simultaneously means 4 voice pipeline calls.",
        "Estimated cost: around 0.012 USD per experience log.",
        "At 1,000 users per day that is roughly 12 USD per day in AI costs for this feature alone.",
    ],
    [
        "Option A -- Generate LinkedIn first, offer other platforms as one-tap expansions",
        "Option B -- Generate all 4 simultaneously (higher cost, slower first response)",
        "Option C -- User picks which platforms before answering questions",
    ],
    "Taplio generates LinkedIn only. VoiceMoat generates X only. Predis.ai generates all platforms simultaneously (their model is visual so cost structure is different).",
    "Option A. Generate LinkedIn first. It cuts cost by 75 percent and makes the first output appear faster. Other platforms on demand."
))

story.append(PageBreak())

# ─────────────────────────────────────────────────────────
# CATEGORY 4
# ─────────────────────────────────────────────────────────
story.append(cat_header(4, "Voice System",
    "The existing voice pipeline is the most sophisticated piece in the codebase. These questions determine whether to extend or rebuild."))

story.append(question(
    11,
    "How does a new user build their voice profile on day one?",
    [
        "Voice Lab currently has 4 routes: analyze, interview, import, save.",
        "Critical question: can a new user reach 'this sounds like me' in under 5 minutes?",
    ],
    [],
    "VoiceMoat requires 100 to 200 posts minimum. Lately.ai requires 3 to 6 months of past content. Jasper requires uploading brand guidelines docs. All require significant upfront work.",
    "A voice profile that works from 3 to 5 sample posts on day one, then improves automatically as the user publishes more. The brain sync already does this but the UX does not make it visible. Show the user their voice improving over time."
))

story.append(question(
    12,
    "What voice match score threshold makes a post good enough to publish?",
    [
        "The voice_match_score and ai_score are returned by the pipeline on every generation.",
        "Currently no threshold is enforced. Every output is shown regardless of score.",
    ],
    [],
    "VoiceMoat shows a live percentage match as you type. Jasper shows an off-brand warning when you deviate from brand voice. Neither auto-blocks posting.",
    "Show the score visually (green above 75, amber 50 to 75, red below 50). Never auto-block. Show a message like 'This scores 54 percent voice match -- want to revise?' before publish is clicked."
))

story.append(question(
    13,
    "Does the voice model need to be per-platform or is one model enough?",
    [
        "Writing for LinkedIn is different from writing for X. Same person, different register.",
        "Platform-specific formatting already exists in voice-prompts.ts.",
    ],
    [],
    "Taplio is LinkedIn-only so this is not their problem. VoiceMoat is X-only. Lately.ai uses one voice model with platform format adapters -- exactly what Content OS currently does.",
    "One voice model, platform adapters (already built). Per-platform voice examples in Voice Lab as a power user feature in a later sprint."
))

story.append(PageBreak())

# ─────────────────────────────────────────────────────────
# CATEGORY 5
# ─────────────────────────────────────────────────────────
story.append(cat_header(5, "Voice Input (Audio to Post)",
    "Whisper and ElevenLabs integration being added this sprint. Mic button co-exists with text input -- not a replacement."))

story.append(question(
    14,
    "Is voice input a primary input method or a backup when typing is inconvenient?",
    ["This determines how prominent the mic button should be in the UI."],
    [
        "Option A -- Primary: voice is the main way to answer experience questions, mic is front and center",
        "Option B -- Backup: text is default, mic is a small icon next to each text field",
    ],
    "Castmagic made audio the only input. Their entire product is voice to content. That is their identity. VoiceMoat, Buffer, Taplio -- all text only with no voice option.",
    "Option B for sprint 1. Do not redesign UX around voice until you know if users actually use it. Add mic as a secondary icon, measure how often it gets tapped, promote it if adoption is high."
))

story.append(question(
    15,
    "What does the ElevenLabs voice clone actually do -- generate audio posts or check voice quality internally?",
    ["Two very different uses with very different build complexity."],
    [
        "Use A -- User records audio, ElevenLabs trains voice clone, Content OS generates audio versions of posts for Instagram Reels or Shorts",
        "Use B -- Internal only, Content OS uses the clone to check if generated drafts sound right before showing the user",
    ],
    "Descript uses voice cloning (Overdub) for correcting video audio -- you type the correction, AI speaks it in your voice. Primarily internal utility. No tool currently generates full audio social posts from a voice clone at scale.",
    "Use B in sprint 1 (internal quality check). Use A in Week 2 as a 'Generate audio version' button. Cleaner separation and lower risk."
))

story.append(question(
    16,
    "Does voice input work offline or only with internet?",
    [
        "The teleprompter is explicitly offline-capable.",
        "Whisper transcription requires an API call.",
        "If a user is at an event with spotty wifi and wants to record immediately, what happens?",
    ],
    [],
    "No competitor offers offline voice capture with online transcription queuing for social content creation.",
    "Record offline (browser MediaRecorder works offline, stores blob locally). Transcribe when connection resumes. Show 'Recording saved -- will transcribe when online' state. This is the exact use case (recording at an event) where offline matters most."
))

story.append(PageBreak())

# ─────────────────────────────────────────────────────────
# CATEGORY 6
# ─────────────────────────────────────────────────────────
story.append(cat_header(6, "Calendar Integration",
    "Google Calendar OAuth planned for Day 5 of the sprint."))

story.append(question(
    17,
    "What calendar data does Content OS actually need?",
    [
        "Google Calendar provides: title, description, location, attendees (names and emails), start and end time, attached files, meeting links.",
        "For experience capture: title plus description is probably enough.",
        "Attendees is bonus context (Jensen Huang is listed as an attendee -- generate smarter questions). Is that a privacy concern?",
    ],
    [],
    "No content tool currently reads calendar attendees for content context. Otter.ai reads meeting attendees for meeting notes, not for social content.",
    "Title plus description for sprint 1. Attendees as opt-in enrichment -- show the names, let user confirm before using them in question generation."
))

story.append(question(
    18,
    "How proactive should calendar integration be -- passive or active?",
    [],
    [
        "Option A -- Passive: calendar events show on dashboard as Log Experience cards, user clicks when ready",
        "Option B -- Active: app detects event ended, sends email or push notification 2 hours after event time",
    ],
    "No tool currently sends post-event content nudges based on calendar. Notion AI can read your calendar but does not send content prompts. Otter.ai joins meetings automatically -- that is the closest to proactive calendar action.",
    "Option A for sprint 1. Option B requires email sending service plus background job to monitor event end times. That is Week 2 work."
))

story.append(question(
    19,
    "Google Calendar only or also Outlook and Apple Calendar?",
    [],
    [
        "Google Calendar OAuth -- straightforward setup",
        "Outlook -- requires Microsoft Azure app registration, more complex",
        "Apple Calendar (CalDAV) -- most restrictive, least documented",
    ],
    "Google Suite plus Google Calendar has roughly 3 billion users. Microsoft 365 has around 345 million paid seats, mostly enterprise. For the target user (founder, indie creator) Google Calendar is dominant.",
    "Google only for sprint 1. Outlook in sprint 2 if enterprise or corporate users start showing up."
))

story.append(PageBreak())

# ─────────────────────────────────────────────────────────
# CATEGORY 7
# ─────────────────────────────────────────────────────────
story.append(cat_header(7, "Publishing and Platform Strategy",
    "Ayrshare dependency, platform priorities, and direct API question."))

story.append(question(
    20,
    "Is Ayrshare the permanent publishing layer or a bridge until direct API is built?",
    [
        "Current state: direct.ts exists as a stub returning an error. Ayrshare adds per-call cost on top of Content OS cost. Ayrshare can change pricing or go down.",
    ],
    [],
    "Buffer built direct platform integrations over 15 years of OAuth maintenance work. Taplio is LinkedIn-only so they maintain one direct integration. FeedHive and SocialBee use Meta's API directly for Instagram. Building direct means months of work per platform.",
    "Ayrshare permanently for Instagram (Meta API is notoriously restrictive and changes often). Direct OAuth for X and LinkedIn is achievable and removes the dependency. Build direct when Ayrshare cost becomes significant."
))

story.append(question(
    21,
    "What is the priority order of platforms for a new user?",
    ["If a new user connects only one platform, which should Content OS recommend?"],
    [],
    "LinkedIn: highest value for professional content, Taplio charges $65/mo for LinkedIn only. X: highest velocity, VoiceMoat and Typefully are X-focused. Instagram: highest reach but hardest API. Threads: easiest API, growing fast in 2026.",
    "Recommend LinkedIn first for the professional and founder persona. X second. Threads third (free, easy API, growing). Instagram last (requires an image, strictest API, most expensive via Ayrshare)."
))

story.append(PageBreak())

# ─────────────────────────────────────────────────────────
# CATEGORY 8
# ─────────────────────────────────────────────────────────
story.append(cat_header(8, "Pricing and Business Model",
    "These answers shape the free tier design and the conversion funnel."))

story.append(question(
    22,
    "What does the free plan allow -- and is it generous enough to activate users?",
    [
        "Current free plan: 1 connected account, 5 publishes per month, 30 AI generations, canPublish set to false.",
        "The problem: canPublish is false on free. Free users can only generate and view drafts. They cannot publish at all.",
        "If free users cannot publish, they cannot experience the core value of the product.",
    ],
    [],
    "Buffer free: 3 channels, 10 posts, unlimited AI writing. Typefully free: 15 posts per month with scheduling. Predis.ai free: 15 posts per month. Most successful tools give publishing access on the free plan.",
    "Free should allow publishing. Suggested free plan: 1 platform, 5 publishes per month, 10 AI generations. Let them publish and hit the wall quickly. The wall converts -- the blank wall does not."
))

story.append(question(
    23,
    "What is the target price point -- creator tier ($15 to $29 per month) or professional tier ($49 to $99 per month)?",
    ["No public pricing exists yet. This decision affects positioning and the type of user who signs up."],
    [],
    "Buffer Essentials: $5 per channel (commodity). Typefully Pro: $8 per month (entry). FeedHive Creator: $19 per month (mid market). VoiceMoat Starter: $25 per month (premium personal brand). Taplio Standard: $65 per month (professional). Jasper Pro: $69 per month (enterprise-lite).",
    "Voice-matched tools charge more than scheduling tools. If voice is the core product, pricing should be closer to VoiceMoat ($25 to $50 per month) than Buffer ($5 to $10). Suggested: Starter at $29, Growth at $59, Pro at $99."
))

story.append(question(
    24,
    "Should additional workspaces be free or a paid add-on?",
    [
        "Currently workspaces let one user manage multiple creator brands.",
        "This is the agency and multi-brand feature.",
    ],
    [],
    "FeedHive charges per account managed. ContentStudio has Agency Unlimited at $99 per month. SocialBee charges per profile slot.",
    "Personal workspace included in all plans. Additional workspaces (second brand or client) as a paid add-on, not requiring a plan upgrade. This lets agencies pay per client without a forced tier jump."
))

story.append(PageBreak())

# ─────────────────────────────────────────────────────────
# CATEGORY 9
# ─────────────────────────────────────────────────────────
story.append(cat_header(9, "Technical Checks",
    "These need verified answers before fixing bugs and building new features. Wrong assumptions here break the whole sprint."))

story.append(question(
    25,
    "Is the auth cookie name definitely 'content-os-token' in all environments?",
    [
        "Middleware checks for content-os-token.",
        "The original PRD mentioned insforge-session.",
        "If there is a mismatch between what InsForge sets and what middleware checks, auth silently breaks for everyone.",
    ],
    [],
    "No competitor reference -- this is an internal implementation question.",
    "Verify against the live deployment before fixing any auth bugs. One wrong cookie name means every user gets logged out when the fix ships."
))

story.append(question(
    26,
    "Are any tables in production already configured with RLS in the InsForge dashboard (separate from schema.sql)?",
    [
        "The schema.sql file has zero CREATE POLICY statements.",
        "InsForge may have RLS configured through its dashboard UI separately from the SQL file.",
        "If we add RLS to schema.sql without knowing what is already active, we may double-apply policies and break queries.",
    ],
    [],
    "No competitor reference -- this is an internal database question.",
    "Verify against the live InsForge project dashboard before the RLS sprint. List existing policies first, then add only what is missing."
))

story.append(question(
    27,
    "What is SOCIAL_PROVIDER_MODE set to in production right now?",
    [
        "The publish cron branches on this: ayrshare mode or direct mode.",
        "Direct mode currently creates zombie jobs (BUG-10 in the audit).",
        "If production is accidentally set to direct, every scheduled post has been silently failing.",
    ],
    [],
    "No competitor reference -- this is an internal configuration question.",
    "Check the live InsForge secrets or Vercel environment variables before the sprint starts. If it is set to direct, posts are not going out."
))

story.append(question(
    28,
    "Which tables actually exist in the production database right now?",
    [
        "The schema.sql covers the core tables.",
        "The production-delta.sql covers billing, publish queue, and engagement.",
        "The creator_brain_pages, workspaces, and workspace_members tables may or may not have been applied to the live database.",
    ],
    [],
    "No competitor reference -- this is an internal database question.",
    "Run a table listing command against the live InsForge database before assuming these tables exist. The voice pipeline silently falls back to empty brain context if creator_brain_pages is missing."
))

story.append(PageBreak())

# ─────────────────────────────────────────────────────────
# CATEGORY 10
# ─────────────────────────────────────────────────────────
story.append(cat_header(10, "Growth and Distribution",
    "Final category. Answers here shape everything beyond this sprint."))

story.append(question(
    29,
    "Who are the first 100 users and how do you reach them?",
    [
        "Content OS has no public signup page, no marketing, no visible waitlist currently.",
        "The question is not just who -- it is how you reach them without a budget.",
    ],
    [],
    "Taplio: Tibo built it for himself as a LinkedIn creator, posted about building it on LinkedIn, went viral. 10M+ exit in 18 months. VoiceMoat: launched to X personal brand community, grew via word of mouth. Beehiiv: launched via newsletter creator community (Substack refugees). Pattern: build for yourself, post about building it, your audience becomes your first users.",
    "Anirudh has the exact right background for this. Post the journey of building Content OS on the same platforms it helps people post on. That is the most authentic distribution strategy available."
))

story.append(question(
    30,
    "What does success look like at the end of this sprint -- specifically and measurably?",
    [
        "Not 'the feature works.' Something a real person can verify in 10 minutes.",
        "Define the minimum version that still proves the core insight if Day 5 does not happen.",
    ],
    [
        "Example A -- 3 real creators use the experience capture flow and say drafts sound like them without editing",
        "Example B -- Voice match score above 75 percent on experience-generated posts",
        "Example C -- End-to-end: calendar event to 4 platform drafts in under 3 minutes",
    ],
    "No competitor reference -- this is a product definition question.",
    "Pick one concrete metric and one user quote as the success definition. If the calendar integration (Day 5) does not ship, the minimum success is: user types event name, answers 5 questions, gets a LinkedIn post that scores above 70 percent voice match. That proves the concept even without calendar."
))

# Final note
story += [
    hr(),
    Paragraph("AFTER THE MEETING", SECTION_L),
    Paragraph(
        "Once Q1 to Q13 are answered, bring those decisions back and the sprint plan will be updated to match. "
        "The week plan in the planning PDF (content-os-planning-jun2026.pdf) is the current best guess -- "
        "specific answers to these questions may shift Day 1 or Day 2 priorities.",
        BODY_MUT),
    gap(6),
    Paragraph("Generated by Content OS Planning Session -- June 2026", BODY_MUT),
]

doc.build(story)
print(f"PDF written: {os.path.abspath(OUTPUT_PATH)}")
