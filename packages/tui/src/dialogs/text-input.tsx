import { useState, useCallback } from 'react';
import { useKeyboard } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';
import { THEME } from '../theme.js';
import { DialogOverlay } from './dialog-stack.js';

export type TextInputProps = {
  title: string;
  description: string;
  placeholder?: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

export function TextInputDialog({
  title,
  description,
  placeholder = '',
  initialValue = '',
  onSubmit,
  onCancel,
}: TextInputProps) {
  const [value, setValue] = useState(initialValue);

  // Handle Enter via useKeyboard since OpenTUI's <input> onSubmit has a
  // type conflict with the DOM SubmitEvent when "DOM" lib is in scope.
  useKeyboard((event: KeyEvent) => {
    if (event.name === 'return') {
      onSubmit(value || initialValue);
      event.preventDefault();
    } else if (event.name === 'escape') {
      onCancel();
      event.preventDefault();
    }
  });

  return (
    <DialogOverlay>
      <text content={title} fg={THEME.BOLD_FG} />
      <text content={description} fg={THEME.DIM} />
      <box height={1} />
      <input
        placeholder={placeholder || initialValue}
        value={value}
        focused={true}
        width={40}
        onInput={setValue}
      />
      <box height={1} />
      <text content="Enter submit  Esc cancel" fg={THEME.DIM} />
    </DialogOverlay>
  );
}
