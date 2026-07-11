'use client';

import { useEffect, useCallback, type ReactNode } from 'react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({ open, onClose, children }: DrawerProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/25 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="absolute right-0 top-0 h-full w-full max-w-[min(560px,100vw)] overflow-y-auto border-l border-hair bg-paper/95 p-5 shadow-[0_20px_50px_-30px_rgba(23,23,23,0.25)] backdrop-blur-xl md:p-6"
        style={{ animation: 'slideIn 0.15s ease-out' }}
      >
        {children}
      </div>
    </div>
  );
}
