import { PRODUCT_NAME } from '@/lib/brand';

/**
 * Soft-fail screen when Content OS core tables are missing or wrong-shaped
 * on the linked InsForge project (e.g. shared Ada/tryada DB).
 */
export default function SchemaSetupRequired() {
  return (
    <div className="editorial flex min-h-screen items-center justify-center bg-paper px-6 text-ink">
      <div className="max-w-lg space-y-3 text-center">
        <p className="text-[11px] font-medium tracking-[0.01em] text-ink2">
          Setup required
        </p>
        <h1 className="text-xl font-semibold tracking-tight">Database not provisioned</h1>
        <p className="text-sm leading-relaxed text-ink2">
          {PRODUCT_NAME} database is not provisioned on this InsForge project. Link a clean project and
          apply db/APPLY_ORDER.md (core steps 1–10).
        </p>
      </div>
    </div>
  );
}
