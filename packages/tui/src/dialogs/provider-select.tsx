import { useState, useCallback } from 'react';
import { useKeyboard } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';
import { PROVIDER_CHOICES } from '../menu/options.js';
import { THEME } from '../theme.js';
import { DialogOverlay } from './dialog-stack.js';

export type ProviderSelectProps = {
  title?: string;
  onConfirm: (providers: string[]) => void;
  onCancel: () => void;
};

export function ProviderSelectDialog({
  title = 'Provider Filter',
  onConfirm,
  onCancel,
}: ProviderSelectProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const toggle = useCallback(
    (index: number) => {
      const provider = PROVIDER_CHOICES[index];
      if (!provider) return;
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(provider.value)) next.delete(provider.value);
        else next.add(provider.value);
        return next;
      });
    },
    [],
  );

  useKeyboard((event: KeyEvent) => {
    switch (event.name) {
      case 'up':
        setSelectedIndex((i) => (i - 1 + PROVIDER_CHOICES.length) % PROVIDER_CHOICES.length);
        event.preventDefault();
        break;
      case 'down':
        setSelectedIndex((i) => (i + 1) % PROVIDER_CHOICES.length);
        event.preventDefault();
        break;
      case 'space':
        toggle(selectedIndex);
        event.preventDefault();
        break;
      case 'return':
        onConfirm(Array.from(checked));
        event.preventDefault();
        break;
      case 'escape':
        onCancel();
        event.preventDefault();
        break;
    }
  });

  return (
    <DialogOverlay>
      <text content={title} fg={THEME.BOLD_FG} />
      <text content="Toggle one or more providers. Leave all unchecked for auto-detection." fg={THEME.DIM} />
      <box height={1} />
      {PROVIDER_CHOICES.map((provider, index) => {
        const isActive = index === selectedIndex;
        const isChecked = checked.has(provider.value);
        const pointer = isActive ? '>' : ' ';
        const checkbox = isChecked ? '[x]' : '[ ]';
        const fg = isActive ? THEME.BOLD_FG : THEME.FG;
        return (
          <text
            key={provider.value}
            content={`${pointer} ${checkbox} ${provider.label}  ${provider.description}`}
            fg={fg}
          />
        );
      })}
      <box height={1} />
      <text content="↑/↓ move  Space toggle  Enter confirm  Esc cancel" fg={THEME.DIM} />
    </DialogOverlay>
  );
}
