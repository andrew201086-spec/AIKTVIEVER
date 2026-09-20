import React from 'react';
import { AlertTriangle, ClipboardCopy, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  /** What broke, in the user's terms: «Панорама», «Карточка зуба». */
  title: string;
  /** What the user loses by continuing, and what still works. */
  hint?: string;
  /** Offered as «Закрыть» when the broken part can simply be dismissed. */
  onDismiss?: () => void;
  dismissLabel?: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: string;
  attempt: number;
}

/**
 * Keeps one broken part from taking the study with it.
 *
 * Without a boundary anywhere in the tree, a single exception in render
 * unmounts the whole application: the user is left with a black window, and a
 * volume that took two minutes and 750 MB to build has to be loaded again.
 * Wrapping the reformations separately from the slices means a bug in the
 * panorama costs the panorama, not the study.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: '', attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Сбой в компоненте:', error, info);
    this.setState({ info: info.componentStack || '' });
  }

  private retry = () => {
    // The key on the subtree changes with the attempt, so children remount
    // from scratch rather than re-rendering into the same broken state.
    this.setState((current) => ({ error: null, info: '', attempt: current.attempt + 1 }));
  };

  private copyReport = async () => {
    const { error, info } = this.state;
    const report = [
      `Просмотр КЛКТ — сбой: ${this.props.title}`,
      `Время: ${new Date().toISOString()}`,
      `Браузер: ${navigator.userAgent}`,
      '',
      `${error?.name}: ${error?.message}`,
      error?.stack ?? '',
      info,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      // Clipboard blocked — the text is on screen anyway.
    }
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    }

    return (
      <div className="w-full h-full min-h-[200px] flex items-center justify-center p-6 bg-gray-950">
        <div className="max-w-lg w-full bg-red-950/40 border border-red-500/50 rounded-xl p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-red-200">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <h3 className="font-semibold text-base">{this.props.title} — сбой</h3>
          </div>

          <p className="text-sm text-red-100/90 leading-relaxed">
            {this.props.hint ?? 'Исследование осталось загруженным — можно продолжить работу.'}
          </p>

          <p className="text-[11px] font-mono text-red-300/80 break-words bg-black/30 rounded p-2 max-h-28 overflow-auto">
            {error.name}: {error.message}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={this.retry}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Попробовать снова
            </button>
            {this.props.onDismiss && (
              <button
                onClick={this.props.onDismiss}
                className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded border border-gray-700"
              >
                {this.props.dismissLabel ?? 'Закрыть'}
              </button>
            )}
            <button
              onClick={this.copyReport}
              title="Скопировать текст ошибки, чтобы переслать разработчику"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700"
            >
              <ClipboardCopy className="w-3.5 h-3.5" />
              Скопировать отчёт
            </button>
          </div>
        </div>
      </div>
    );
  }
}
