import "@testing-library/jest-dom/vitest";

// happy-dom's ResizeObserver never delivers a contentRect, so the fence-map
// treemap (which sizes itself from its container) would lay out zero tiles
// in tests. Report a fixed 800x560 box on observe.
class FixedSizeResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb(
      [{ target, contentRect: { width: 800, height: 560, x: 0, y: 0, top: 0, left: 0, bottom: 560, right: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = FixedSizeResizeObserver as unknown as typeof ResizeObserver;

// jsdom/happy-dom lack matchMedia; the app uses it for the system theme.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
