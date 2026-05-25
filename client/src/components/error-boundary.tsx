import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Optional fallback renderer. If omitted a generic error card is shown.
   * Receives the caught error plus a `reset()` function that clears the
   * boundary state so the children can re-render.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

/**
 * Top-level React error boundary. Wraps the whole app so a single buggy
 * dialog or page never blanks the entire UI — instead the user gets a clear
 * recovery card with Reload / Home actions.
 *
 * We use a class component because hooks can't catch render errors yet.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Caught:", error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback && this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }

    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full rounded-2xl border bg-card shadow-xl overflow-hidden">
          <div
            className="px-6 py-5 text-white"
            style={{
              background:
                "linear-gradient(135deg, hsl(0 70% 32%) 0%, hsl(0 75% 50%) 100%)",
            }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 ring-1 ring-white/30 grid place-items-center backdrop-blur">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold leading-tight">Something went wrong</h2>
                <p className="text-xs text-white/80 mt-0.5">
                  A piece of the interface crashed. Your data is safe.
                </p>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              You can try the action again, or go back to the dashboard.
              If the problem keeps happening, copy the error below and send it
              to your administrator.
            </p>

            <details className="text-[11px] font-mono bg-muted/40 rounded-md p-3 border border-border max-h-32 overflow-auto">
              <summary className="cursor-pointer text-foreground font-semibold">
                Error details
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                {this.state.error?.name}: {this.state.error?.message}
              </pre>
            </details>

            <div className="flex gap-2">
              <button
                onClick={this.reset}
                className="flex-1 inline-flex items-center justify-center gap-2 h-10 rounded-md bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition"
                data-testid="error-boundary-retry"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Try again
              </button>
              <button
                onClick={() => {
                  this.reset();
                  window.location.href = "/";
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 h-10 rounded-md border border-border bg-card text-foreground font-semibold text-sm hover:bg-accent transition"
                data-testid="error-boundary-home"
              >
                <Home className="w-3.5 h-3.5" /> Go home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
