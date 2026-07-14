// Must be first: defines a browser `process` global before any module that
// reads process.env at module scope (page code and some of its deps do).
import './process-shim';

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

// Preview harness (excluded from the component list via componentSrcMap;
// exported so page previews can wrap themselves in it).
export { PreviewShell, registerFetchMock } from './preview-shell';

// Full-page screens — every client-component page in the app, importable so
// whole pages can be opened and reworked in claude.ai/design. Server pages
// (admin, dashboard home, brain, signals, landing) cannot ship: they import
// server-only code.
export { default as LeadsPage } from '@/app/(dashboard)/leads/page';
export { default as CalendarPage } from '@/app/(dashboard)/calendar/page';
export { default as AnalyticsPage } from '@/app/(dashboard)/analytics/page';
export { default as IdeasPage } from '@/app/(dashboard)/ideas/page';
export { default as LibraryPage } from '@/app/(dashboard)/library/page';
export { default as SettingsPage } from '@/app/(dashboard)/settings/page';
export { default as GeneratePage } from '@/app/(dashboard)/generate/page';
export { default as InboxPage } from '@/app/(dashboard)/inbox/page';
export { default as VoiceLabPage } from '@/app/(dashboard)/voice-lab/page';
export { default as VideoStudioPage } from '@/app/(dashboard)/video-studio/page';
export { default as OnboardingPage } from '@/app/(dashboard)/onboarding/page';
export { default as SeriesPage } from '@/app/(dashboard)/series/page';
export { default as StoryBankPage } from '@/app/(dashboard)/story-bank/page';
export { default as TeleprompterPage } from '@/app/(dashboard)/teleprompter/page';
export { default as EventCapturePage } from '@/app/(dashboard)/event-capture/page';
export { default as LoginPage } from '@/app/(auth)/login/page';
