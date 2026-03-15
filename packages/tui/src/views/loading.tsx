import { useState, useEffect } from 'react';
import type { InteractiveRunRequest } from '../menu/types.js';
import { THEME } from '../theme.js';

const BRAILLE_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export type LoadingViewProps = {
  request: InteractiveRunRequest;
};

export function LoadingView({ request }: LoadingViewProps) {
  const [frame, setFrame] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const ticker = setInterval(() => {
      setFrame((f) => f + 1);
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 120);
    return () => clearInterval(ticker);
  }, [startedAt]);

  const spinner = BRAILLE_SPINNER[frame % BRAILLE_SPINNER.length];
  const barWidth = 30;
  const cycle = barWidth * 2;
  const position = frame % cycle;
  const fillCount = position <= barWidth ? position : cycle - position;
  const filled = '\u2588'.repeat(fillCount);
  const empty = '\u2591'.repeat(barWidth - fillCount);

  return (
    <box flexDirection="column" width="100%">
      <text content={request.loadingTitle} fg={THEME.BOLD_FG} />
      <text content={request.preview} fg={THEME.CYAN} />
      <box height={1} />
      <text content={request.loadingDetail} fg={THEME.DIM} />
      <box height={1} />
      <text content={`${spinner} Working... [${filled}${empty}] ${elapsed}s`} fg={THEME.SUCCESS} />
    </box>
  );
}
