import { useEffect, useState } from "react";

/**
 * Track a `matchMedia` query, for the rare layout that genuinely needs a
 * different control on a phone rather than something CSS alone can express
 * (a `Popover` that has nowhere to open into on a 390px viewport, say).
 * Reach for CSS breakpoints first; this is for when the two sides render
 * different components, not just different styles.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);

    const onChange = () => setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
