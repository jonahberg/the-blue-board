// @vitest-environment jsdom
/**
 * A component that throws — in render or in an effect — must be contained by the boundary
 * instead of unmounting the whole dashboard island (the v1.8.0 black-page crash).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from '../src/app/shell/ErrorBoundary';

function ThrowsInEffect() {
  useEffect(() => {
    throw new Error('Invalid LatLng object: (NaN, NaN)');
  }, []);
  return <p>map</p>;
}

let broken = true;
function Flaky() {
  if (broken) throw new Error('boom');
  return <p>recovered</p>;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  broken = true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('contains an error thrown inside an effect and keeps siblings mounted', () => {
    render(
      <div>
        <p>header stays</p>
        <ErrorBoundary scope="This tab">
          <ThrowsInEffect />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByText('header stays')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('This tab hit an error');
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
  });

  it('"Try again" re-renders the children', () => {
    render(
      <ErrorBoundary scope="This tab">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('This tab hit an error');
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('recovered')).toBeTruthy();
  });
});
