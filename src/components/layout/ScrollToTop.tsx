import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Reset scroll on navigation, but leave in-page anchors alone and respect
 * a reduced-motion preference.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, left: 0, behavior: reduced ? "auto" : "smooth" });
  }, [pathname, hash]);

  return null;
}
