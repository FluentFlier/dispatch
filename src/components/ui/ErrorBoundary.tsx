'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="w-12 h-12 text-text-tertiary mb-4" />
          <h2 className="font-heading text-[16px] font-semibold text-text-primary mb-1">
            Something went wrong
          </h2>
          <p className="text-text-tertiary text-[13px] mb-4 max-w-md">
            An unexpected error occurred. Try refreshing or come back later.
          </p>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 bg-accent-primary hover:bg-accent-dark text-text-inverse text-[13px] font-medium px-5 py-[10px] rounded-md transition-colors"
          >
            <RefreshCw size={14} />
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
