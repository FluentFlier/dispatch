# Content OS — design system conventions

Content OS is a content command center for creators and founders. This library is the
**light product-app surface** (dashboard, composer, library). The marketing landing page uses a
separate, scoped dark theme (`.os-landing`, `os-*` tokens) that must NOT leak into product UI.

## Styling idiom: Tailwind utilities with semantic tokens

Style with Tailwind utility classes built on **semantic token names** — never raw hex, never arbitrary
palettes. Compose your own layout (flex, grid, spacing) with these same utilities. The components carry
their own internal styling; you supply layout and, where a component needs it, a color class.

Core class vocabulary (all defined in `styles.css` / `tailwind.config.ts`):

| Purpose | Classes |
|---|---|
| Surfaces (bg) | `bg-bg-primary` (app canvas), `bg-bg-secondary` (cards/inputs), `bg-bg-tertiary` (hover/muted), `bg-bg-elevated` |
| Text | `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `text-text-inverse` |
| Borders | `border-border` (hover/focus state: `focus:border-border-hover`) |
| Accent | `bg-accent-primary` (hover: `hover:bg-accent-dark`), `text-accent-primary`, `text-accent-secondary` (teal), `bg-accent-light` |
| Brand tints | `bg-coral-light`, `bg-sage-light`, `text-coral`, `text-sage` |
| Radius | `rounded-md` (6px), `rounded-lg` (8px), `rounded-pill`, `rounded-badge` |
| Shadow | `shadow-card`, `shadow-soft` |
| Type | `font-body`/`font-display`/`font-heading` (DM Sans), `font-mono` (JetBrains). Fraunces & Hanken serve the dark landing only, via the `os-serif` / `os-mono` classes. |

There are also ready-made composite classes for common patterns: `card-surface`, `btn-primary`,
`btn-secondary`, `btn-ghost`, `section-label`, `chip`, `empty-state`, `page-shell`, `page-title`. Prefer the real `Button`/`Card` components over `btn-*`/`card-surface` when one exists.

## Wrapping / setup

- **Most components need no provider** — they render styled on their own.
- **Toasts** require wrapping the app (or subtree) in `ToastProvider`, then calling `useToast()` inside:
  `const { toast } = useToast(); toast('Draft saved', 'success')`. Types: `'success' | 'error'`.
- **Modal** and **Drawer** are controlled overlays: pass `open` and `onClose`; they render a fixed
  full-screen backdrop and return `null` when closed.
- **Badge** has no default background — always give it a color class
  (e.g. `<Badge className="bg-coral-light text-accent-primary">New</Badge>`).
- **Skeleton** has no intrinsic size — always give it `h-*`/`w-*` (circle via `rounded-full`).

## Where the truth lives

- `styles.css` (and the `_ds_bundle.css` it imports) — the full token + utility definitions. Read it
  before styling.
- `guidelines/DESIGN.md` — brand direction, typography rationale, color philosophy, the light/dark split.
- Each component's `<Name>.d.ts` (props) and `<Name>.prompt.md` (usage).

## Idiomatic example

```tsx
import { Card, Button, StatusBadge, Badge } from 'content-os';

function PostRow() {
  return (
    <Card className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-body font-medium text-text-primary">
          5 hooks that stopped the scroll
        </span>
        <div className="flex items-center gap-2">
          <StatusBadge status="scripted" />
          <Badge className="bg-bg-tertiary text-text-tertiary">LinkedIn</Badge>
        </div>
      </div>
      <Button size="sm">Edit</Button>
    </Card>
  );
}
```
