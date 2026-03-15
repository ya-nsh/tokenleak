import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';
import type { InteractiveRunRequest, InteractiveExecutionResult } from '../menu/types.js';
import { AnsiText, getScrollInfo } from '../components/ansi-text.js';
import { StatusBar } from '../components/status-bar.js';
import { THEME } from '../theme.js';
import { useLayoutMode } from '../hooks/use-layout-mode.js';

export type ResultViewProps = {
  request: InteractiveRunRequest;
  result: InteractiveExecutionResult;
  onReturn: () => void;
  onExit: () => void;
};

export function ResultView({ request, result, onReturn, onExit }: ResultViewProps) {
  const { height } = useLayoutMode();
  const [scrollInfo, setScrollInfo] = useState<string | null>(null);

  const statusColor = result.ok ? THEME.SUCCESS : THEME.ERROR;
  const statusLabel = result.ok ? 'Completed' : 'Failed';

  const sections: string[] = [];
  if (result.stdout.trim()) {
    sections.push(result.stdout.trimEnd());
  }
  if (result.stderr.trim()) {
    sections.push(result.stderr.trimEnd());
  }
  const content = sections.join('\n\n');

  const headerHeight = 7;
  const footerHeight = 2;
  const viewportHeight = Math.max(4, height - headerHeight - footerHeight);

  useKeyboard((event: KeyEvent) => {
    if (event.name === 'return') {
      onReturn();
      event.preventDefault();
    } else if (event.name === 'q' || event.name === 'escape') {
      onExit();
      event.preventDefault();
    } else if (event.ctrl && event.name === 'c') {
      onExit();
      event.preventDefault();
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%">
      <text content={request.title} fg={THEME.BOLD_FG} />
      <text content={request.preview} fg={THEME.CYAN} />
      <box height={1} />
      <text content={`Status: ${statusLabel}`} fg={statusColor} />
      <text content={result.summary} fg={THEME.DIM} />
      <box height={1} />
      <box flexGrow={1}>
        {content ? (
          <AnsiText
            content={content}
            focused={true}
            viewportHeight={viewportHeight}
            onScrollChange={(offset, total, vp) => setScrollInfo(getScrollInfo(offset, total, vp))}
          />
        ) : (
          <text content="No captured output for this command." fg={THEME.DIM} />
        )}
      </box>
      <StatusBar
        hints={['↑/↓ scroll', 'PgUp/PgDn page', 'Enter launcher', 'Q quit']}
        scrollInfo={scrollInfo}
      />
    </box>
  );
}
