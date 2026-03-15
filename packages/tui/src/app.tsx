import { useState, useCallback, useRef } from 'react';
import type { TokenleakOutput, DateRange } from '@tokenleak/core';
import type { IProvider } from '@tokenleak/registry';
import type {
  InteractiveCommand,
  InteractiveContext,
  InteractiveExecutionResult,
  InteractiveRunRequest,
  TabbedDashboardOptions,
} from './menu/types.js';
import { useToast } from './hooks/use-toast.js';
import { Launcher } from './views/launcher.js';
import { LoadingView } from './views/loading.js';
import { ResultView } from './views/result.js';
import { Dashboard } from './views/dashboard.js';
import { ToastContainer } from './components/toast.js';

export type AppView = 'launcher' | 'loading' | 'result' | 'dashboard';

export type AppProps = {
  context: InteractiveContext;
  providers: IProvider[];
  execute: (request: InteractiveRunRequest) => Promise<InteractiveExecutionResult>;
  loadData: (providers: IProvider[], range: DateRange, compare: string | null) => Promise<TokenleakOutput>;
  onExit: () => void;
};

export function App({ context, providers, execute, loadData, onExit }: AppProps) {
  const [view, setView] = useState<AppView>('launcher');
  const [activeRequest, setActiveRequest] = useState<InteractiveRunRequest | null>(null);
  const [activeResult, setActiveResult] = useState<InteractiveExecutionResult | null>(null);
  const [dashboardOptions, setDashboardOptions] = useState<TabbedDashboardOptions | null>(null);
  const { toasts, show: showToast } = useToast();
  const executeRef = useRef(execute);
  executeRef.current = execute;

  const handleCommand = useCallback(
    async (command: InteractiveCommand) => {
      if (command.type === 'exit') {
        onExit();
        return;
      }

      if (command.type === 'show-help') {
        // For now, just stay on launcher — help overlay handled within launcher
        return;
      }

      if (command.type === 'tabbed-dashboard') {
        setDashboardOptions(command.options);
        setView('dashboard');
        return;
      }

      if (command.type === 'run') {
        setActiveRequest(command.request);
        setView('loading');

        try {
          const result = await executeRef.current(command.request);
          setActiveResult(result);
          setView('result');
          if (result.ok) {
            showToast('Command completed');
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          setActiveResult({
            ok: false,
            summary: message,
            stdout: '',
            stderr: message,
          });
          setView('result');
        }
      }
    },
    [onExit, showToast],
  );

  const handleReturnToLauncher = useCallback(() => {
    setView('launcher');
    setActiveRequest(null);
    setActiveResult(null);
    setDashboardOptions(null);
  }, []);

  return (
    <box flexDirection="column" width="100%" height="100%">
      {view === 'launcher' && (
        <Launcher
          context={context}
          onCommand={handleCommand}
          onShowHelp={() => {/* help overlay TBD */}}
        />
      )}
      {view === 'loading' && activeRequest && (
        <LoadingView request={activeRequest} />
      )}
      {view === 'result' && activeRequest && activeResult && (
        <ResultView
          request={activeRequest}
          result={activeResult}
          onReturn={handleReturnToLauncher}
          onExit={onExit}
        />
      )}
      {view === 'dashboard' && dashboardOptions && (
        <Dashboard
          providers={providers}
          options={dashboardOptions}
          loadData={loadData}
          onExit={handleReturnToLauncher}
        />
      )}
      <ToastContainer toasts={toasts} />
    </box>
  );
}
