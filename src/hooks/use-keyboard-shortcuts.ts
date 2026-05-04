'use client';

import { useEffect, useCallback } from 'react';

interface ShortcutConfig {
  key: string;           // e.g., 'n', 'Escape', '?'
  ctrl?: boolean;        // Ctrl/Cmd modifier
  shift?: boolean;       // Shift modifier
  alt?: boolean;         // Alt modifier
  handler: () => void;   // Action to perform
  description: string;   // For help tooltip
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in inputs/textareas
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    ) {
      return;
    }

    for (const shortcut of shortcuts) {
      const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatch = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
      const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
      const altMatch = shortcut.alt ? e.altKey : !e.altKey;

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        e.preventDefault();
        shortcut.handler();
        return;
      }
    }
  }, [shortcuts]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

export type { ShortcutConfig };
