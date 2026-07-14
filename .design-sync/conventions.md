# Content OS — build conventions

## Setup

Components are self-contained React; no theme provider is required. Two exceptions:

- Anything calling `useToast` must sit inside `ToastProvider`.
- **Full-page components** (`LeadsPage`, `CalendarPage`, … every `*Page` export) assume the Next.js app router and a live `/api` backend. Always wrap them in `PreviewShell` (exported from the bundle), which supplies a mock router, `ToastProvider`, and answers `/api/*` fetches with empty payloads so the page renders its zero-data state:

```tsx
import { PreviewShell, LeadsPage } from 'content-os';

<PreviewShell pathname="/leads">
  <LeadsPage />
</PreviewShell>
```

An unwrapped `*Page` throws router/context errors. Non-page components never need `PreviewShell`.

## Styling idiom

Tailwind utility classes over a custom token palette (light, warm-paper UI; default font is DM Sans). Color via these token families — never raw hex, never default Tailwind palette names like `gray-500`:

| Family | Classes |
|---|---|
| Backgrounds | `bg-bg-primary` (page, #FBFAF7), `bg-bg-secondary` (cards, white), `bg-bg-tertiary`, `bg-bg-elevated` |
| Text | `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `text-text-inverse` |
| Borders | `border-border` (default hairline), `border-border-hover`, `border-border-active` |
| Accent (blue) | `bg-accent-primary`, `text-accent-primary`, `bg-accent-light`, `bg-accent-dark` |
| Support | `text-sage` / `bg-sage-light` (success/teal), `text-coral` / `bg-coral-light` (warm alerts) |

Layout helpers from the app's component layer: `page-shell` (standard page width + padding), `page-shell-wide`, `shadow-card` (card elevation).

**Stylesheet coverage caveat**: `styles.css` is compiled Tailwind covering the classes the app itself uses. Common utilities (flex, grid, spacing, type scale) are all present, but an exotic utility the app never used may not be. For unusual one-off layout math, prefer inline `style={{…}}`; keep all color/typography on the token classes above.

## Where the truth lives

- `styles.css` → design tokens and the compiled utility CSS (its `@import` closure includes `_ds_bundle.css`).
- `components/<group>/<Name>/<Name>.prompt.md` → per-component API + usage; `<Name>.d.ts` is the props contract.
- `guidelines/DESIGN.md` → the product's design guidelines.

## Idiomatic composition

```tsx
import { Card, Button, Badge, Input } from 'content-os';

<div className="page-shell bg-bg-primary">
  <Card>
    <div className="flex items-center justify-between gap-4">
      <div>
        <h3 className="text-sm font-medium text-text-primary">Weekly digest</h3>
        <p className="mt-1 text-xs text-text-secondary">Sent every Monday morning.</p>
      </div>
      <Badge>Active</Badge>
    </div>
    <div className="mt-4 flex gap-2">
      <Input placeholder="you@company.com" />
      <Button variant="primary">Subscribe</Button>
    </div>
  </Card>
</div>
```
