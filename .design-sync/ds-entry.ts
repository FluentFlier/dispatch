// Curated design-system entry for /design-sync.
// Re-exports the public UI primitive surface (the src/components/ui barrel)
// plus the branded badge components, deliberately excluding app-only pieces
// like ImageUpload (pulls in next/image runtime) and PlatformConstraints.
// This is the entry the design-system bundle (window.ContentOS) is built from.
export { Button } from '@/components/ui/Button';
export { Badge } from '@/components/ui/Badge';
export { Card } from '@/components/ui/Card';
export { Input } from '@/components/ui/Input';
export { Textarea } from '@/components/ui/Textarea';
export { Select } from '@/components/ui/Select';
export { Modal } from '@/components/ui/Modal';
export { Drawer } from '@/components/ui/Drawer';
export { Skeleton, SkeletonLines } from '@/components/ui/Skeleton';
export { CopyButton } from '@/components/ui/CopyButton';
export { Tabs } from '@/components/ui/Tabs';
export { ToastProvider, useToast } from '@/components/ui/Toast';
export { ErrorBoundary } from '@/components/ui/ErrorBoundary';
export { CharCount } from '@/components/ui/CharCount';
export { default as StatusBadge } from '@/components/ui/StatusBadge';
export { default as PillarBadge } from '@/components/ui/PillarBadge';
