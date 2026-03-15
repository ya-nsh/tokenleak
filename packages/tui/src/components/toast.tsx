import type { Toast } from '../hooks/use-toast.js';
import { THEME } from '../theme.js';

export type ToastContainerProps = {
  toasts: Toast[];
};

export function ToastContainer({ toasts }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <box position="absolute" right={2} top={1} flexDirection="column" gap={0}>
      {toasts.map((toast) => (
        <box key={toast.id} backgroundColor={THEME.ACCENT} padding={0}>
          <text content={` ${toast.message} `} fg={THEME.BOLD_FG} />
        </box>
      ))}
    </box>
  );
}
