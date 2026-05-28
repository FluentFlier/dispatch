# Dispatch Private Beta Checklist

## Reliability gates

- [ ] `/api/health` returns `ok` in production
- [ ] Publish success rate ≥ 95% over 7 days (track via publish_jobs status)
- [ ] Failed jobs surface in dashboard **Needs attention** panel
- [ ] Cron runs every 5 minutes with valid `CRON_SECRET`

## Billing gates

- [ ] Stripe checkout → webhook → `subscriptions` row active
- [ ] Free tier blocked from publish (402 + upgrade CTA)
- [ ] Billing portal opens for existing customers

## Onboarding gates

- [ ] Connect social (Ayrshare JWT or direct OAuth)
- [ ] First scheduled or immediate publish within first session
- [ ] Time-to-first-scheduled-post < 5 minutes (median)

## Daily beta loop

1. Review `publish_jobs` with status `failed` or `dead`
2. Check top 3 `last_error` strings — ship fixes same day
3. Interview 1 user on friction (connect, compose, billing)
4. Track activation: connect + schedule in session 1

## Instrumentation

- Server events via `src/lib/analytics.ts` (set `ANALYTICS_WEBHOOK_URL` for forwarding)
- Key events: `subscription_active`, `publish_failed`, `first_publish_success`, `upgrade_checkout_started`

## Intelligence (advanced / post-beta)

- [ ] Hook mining runs producing 100+ high-quality hooks
- [ ] Research Lab and Generate suggestions surface real RAG hooks
- [ ] Categorized lead analytics (ICP / Potential Leads) visible in Analytics
- [ ] Continuous mining loop (`hooks:listen`) and bulk DB import working
