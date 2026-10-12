import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Reset scroll on navigation, but leave in-page anchors alone and respect
 * a reduced-motion preference.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      // A router Link to "#how" changes the location without the browser's own
      // jump, so the target is scrolled to here. The element may not be
      // painted yet on a fresh load, hence the frame of delay.
      const frame = requestAnimationFrame(() => {
        document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start",
        });
      });
      return () => cancelAnimationFrame(frame);
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, left: 0, behavior: reduced ? "auto" : "smooth" });
  }, [pathname, hash]);

  return null;
}
