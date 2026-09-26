/**
 * The dashboard is one React root: without a boundary, a single throwing render or effect
 * unmounts the whole island and leaves the visitor on a black page (the v1.8.0 map-focus crash,
 * Sep 26 2026). Each tab gets its own boundary so a broken view is contained to that tab, and
 * the whole dashboard gets an outer one so an overlay failure still leaves a way back.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type Props = {
  /** What broke, for the message: "This tab", "The dashboard". */
  scope: string;
  children: ReactNode;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaces in the browser console (and any error tooling) instead of vanishing silently.
    console.error(`[ErrorBoundary] ${this.props.scope} crashed:`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTitle>{this.props.scope} hit an error</AlertTitle>
          <AlertDescription>
            <p>Something went wrong displaying this. Your watched flights and settings are safe.</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={this.reset}>
                Try again
              </Button>
              <Button size="sm" onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
}
