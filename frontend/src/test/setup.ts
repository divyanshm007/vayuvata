import '@testing-library/jest-dom/vitest';

// jsdom has no matchMedia; report a desktop viewport so the permanent sidebar renders.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: /min-width/.test(query), media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  }),
});

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

// Desktop-sized window so the sidebar starts expanded (it auto-collapses below 1200px).
Object.defineProperty(window, 'innerWidth', { writable: true, value: 1400 });
