import { useState, useCallback } from 'react';
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

  const handleSubmit = useCallback(
    (submitted: string) => {
      onSubmit(submitted || initialValue);
    },
    [onSubmit, initialValue],
  );

  // Cast needed: OpenTUI's input onSubmit type intersects with DOM SubmitEvent
  const submitHandler = handleSubmit as unknown as undefined;

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
        onSubmit={submitHandler}
      />
      <box height={1} />
      <text content="Enter submit  Esc cancel" fg={THEME.DIM} />
    </DialogOverlay>
  );
}
