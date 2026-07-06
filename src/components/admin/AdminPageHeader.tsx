import { adminSubtitle, adminTitle } from '@/components/admin/admin-ui';

interface AdminPageHeaderProps {
  title: string;
  description?: string;
}

/**
 * Consistent page header for admin routes.
 */
export function AdminPageHeader({ title, description }: AdminPageHeaderProps) {
  return (
    <div>
      <h1 className={adminTitle}>{title}</h1>
      {description ? <p className={adminSubtitle}>{description}</p> : null}
    </div>
  );
}
