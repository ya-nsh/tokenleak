import { useCallback } from 'react';
import type { SelectOption } from '@opentui/core';
import { THEME_VARIANTS, type ThemeVariant } from '../theme.js';
import { THEME } from '../theme.js';
import { DialogOverlay } from './dialog-stack.js';

const VARIANT_KEYS = Object.keys(THEME_VARIANTS) as ThemeVariant[];

export type ThemePickerProps = {
  onSelect: (variant: ThemeVariant) => void;
  onCancel: () => void;
};

export function ThemePickerDialog({ onSelect, onCancel }: ThemePickerProps) {
  const options: SelectOption[] = VARIANT_KEYS.map((key) => ({
    name: THEME_VARIANTS[key].name,
    description: `Accent: ${THEME_VARIANTS[key].accent}`,
  }));

  const handleSelect = useCallback(
    (index: number) => {
      const key = VARIANT_KEYS[index];
      if (key) onSelect(key);
    },
    [onSelect],
  );

  return (
    <DialogOverlay>
      <text content="Theme" fg={THEME.BOLD_FG} />
      <text content="Choose a color theme for heatmaps and graphs." fg={THEME.DIM} />
      <box height={1} />
      <select
        options={options}
        focused={true}
        wrapSelection={true}
        selectedBackgroundColor={THEME.ACTIVE}
        selectedTextColor={THEME.BOLD_FG}
        textColor={THEME.FG}
        descriptionColor={THEME.DIM}
        onSelect={handleSelect}
      />
      <box height={1} />
      <text content="↑/↓ move  Enter confirm  Esc cancel" fg={THEME.DIM} />
    </DialogOverlay>
  );
}
