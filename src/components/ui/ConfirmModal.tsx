'use client';

import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  /** Confirm-button label. Defaults to "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" tints the confirm button for destructive, irreversible actions. */
  tone?: 'default' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * A styled confirmation dialog to replace blocking native `window.confirm`
 * calls, so consequential actions (send cold email, delete an ICP) stay inside
 * the app's design system and support a busy state on confirm.
 */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm leading-relaxed text-ink2">{message}</p>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onConfirm}
          loading={loading}
          className={tone === 'danger' ? 'bg-red-600 hover:bg-red-700 text-white' : ''}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
