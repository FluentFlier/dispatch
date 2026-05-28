# Dispatch UI Redesign — GStack iteration plan

## Design north star

**Feel:** Warm cream studio (Ada-like calm), coral CTAs, plain English.  
**User:** Non-technical creator. If they need a tutorial, we failed.  
**Accent:** Coral `#E07A5F` primary · Sage `#3D8B7A` success/secondary

## Loop 1 — Tokens & shell (ship first)

- Cream light mode tokens in `tailwind.config.ts` + `globals.css`
- 15px base font, 44px min touch targets
- Sidebar: 5 items only (Home, Write, Posts, Schedule, Comments)
- Mobile bottom bar matches

## Loop 2 — Home that explains itself

- Big greeting + 3 action cards: Write post, See posts, Reply to comments
- Setup checklist only if incomplete (plain words)
- Stats simplified labels

## Loop 3 — Inbox (engagement)

- `/inbox` — comments grouped by post, empty state with one CTA
- Copy: "We'll pull comments here after you publish" (honest until Outstand)

## Loop 4 — Post workspace tabs

- Library drawer tabs: Write | Schedule | Comments | Stats
- One screen per post, no jargon

## Loop 5 — Polish pass

- Landing page cream/coral
- Onboarding step-by-step (one question per screen feel)
- Voice score chips in Generate

## Out of scope this sprint

- Dark mode toggle
- LangGraph UI
- Full Outstand sync UI
