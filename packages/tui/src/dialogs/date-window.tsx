import { useState, useCallback } from 'react';
import type { CliArgs } from '../menu/types.js';
import { DATE_WINDOW_CHOICES, type Choice } from '../menu/options.js';
import { SingleChoiceDialog } from './single-choice.js';
import { TextInputDialog } from './text-input.js';

type DateWindowStep = 'choice' | 'since' | 'until';

export type DateWindowProps = {
  onConfirm: (rangeArgs: CliArgs) => void;
  onCancel: () => void;
};

export function DateWindowDialog({ onConfirm, onCancel }: DateWindowProps) {
  const [step, setStep] = useState<DateWindowStep>('choice');
  const [since, setSince] = useState('');

  const handleChoice = useCallback(
    (value: string) => {
      if (value === 'custom') {
        setStep('since');
      } else {
        onConfirm({ days: Number(value) });
      }
    },
    [onConfirm],
  );

  const handleSince = useCallback(
    (value: string) => {
      setSince(value);
      setStep('until');
    },
    [],
  );

  const handleUntil = useCallback(
    (value: string) => {
      const args: CliArgs = { since };
      if (value) args['until'] = value;
      onConfirm(args);
    },
    [since, onConfirm],
  );

  if (step === 'since') {
    return (
      <TextInputDialog
        title="Since Date"
        description="Enter start date in YYYY-MM-DD format"
        placeholder="YYYY-MM-DD"
        onSubmit={handleSince}
        onCancel={onCancel}
      />
    );
  }

  if (step === 'until') {
    return (
      <TextInputDialog
        title="Until Date"
        description="Enter end date (blank for today)"
        placeholder="YYYY-MM-DD"
        onSubmit={handleUntil}
        onCancel={onCancel}
      />
    );
  }

  return (
    <SingleChoiceDialog
      title="Date Window"
      description="Choose how much history to include."
      choices={DATE_WINDOW_CHOICES}
      initialIndex={2}
      onSelect={handleChoice}
      onCancel={onCancel}
    />
  );
}
