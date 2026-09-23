import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import './i18n';

// jsdom lacks ResizeObserver, which Kumo's Tabs indicator uses.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => cleanup());
