import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// antd's overlays measure their trigger, and jsdom has no ResizeObserver.
if (!("ResizeObserver" in globalThis)) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

// jsdom implements neither, and both are used by the carousel and ScrollToTop.
if (!("IntersectionObserver" in globalThis)) {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    },
  );
}

/*
 * Tested for callability, not for presence: jsdom *declares* `matchMedia` and
 * leaves it undefined, so an `in` check reports it as already there and skips
 * the stub. Nothing noticed until antd's Table and Modal — which ask for a
 * breakpoint on render — reached a component test.
 */
if (typeof window.matchMedia !== "function") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

Element.prototype.scrollIntoView = vi.fn();

// jsdom has no font-loading API at all. Resolved immediately: nothing here
// ever waits on a real font, so there is no later moment to fire it from.
if (!("fonts" in document)) {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
}
