import { useCallback } from 'react';
import type { SelectOption } from '@opentui/core';
import type { Choice } from '../menu/options.js';
import { THEME } from '../theme.js';
import { DialogOverlay } from './dialog-stack.js';

export type SingleChoiceProps<T extends string> = {
  title: string;
  description: string;
  choices: readonly Choice<T>[];
  initialIndex?: number;
  onSelect: (value: T) => void;
  onCancel: () => void;
};

export function SingleChoiceDialog<T extends string>({
  title,
  description,
  choices,
  initialIndex = 0,
  onSelect,
  onCancel,
}: SingleChoiceProps<T>) {
  const options: SelectOption[] = choices.map((c) => ({
    name: c.label,
    description: c.description,
  }));

  const handleSelect = useCallback(
    (index: number) => {
      const choice = choices[index];
      if (choice) onSelect(choice.value);
    },
    [choices, onSelect],
  );

  return (
    <DialogOverlay>
      <text content={title} fg={THEME.BOLD_FG} />
      <text content={description} fg={THEME.DIM} />
      <box height={1} />
      <select
        options={options}
        selectedIndex={initialIndex}
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
