import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Top-level safety net: a render error shows a friendly full-screen message instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="crash" role="alert">
        <p className="crash__face" aria-hidden="true">
          (・_・;)
        </p>
        <p>
          Something went wrong. Your project is not damaged on disk; unsaved changes may be lost. Please restart the
          editor.
        </p>
        <details>
          <summary>Technical details</summary>
          <pre>{error.stack || error.message}</pre>
        </details>
      </div>
    );
  }
}
