import { THEME } from '../theme.js';

export type StatusBarProps = {
  hints: string[];
  scrollInfo?: string | null;
  refreshCountdown?: number | null;
};

export function StatusBar({ hints, scrollInfo, refreshCountdown }: StatusBarProps) {
  const parts: string[] = [...hints];

  if (refreshCountdown !== null && refreshCountdown !== undefined) {
    parts.push(`refresh: ${refreshCountdown}s`);
  }

  const hintText = parts.join('  ·  ');
  const infoText = scrollInfo ?? '';
  const displayText = infoText ? `${hintText}    ${infoText}` : hintText;

  return (
    <box width="100%" height={1} flexDirection="row">
      <text content={displayText} fg={THEME.DIM} />
    </box>
  );
}
