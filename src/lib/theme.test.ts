import { describe, expect, it } from "vitest";
import { ACTION_BUTTON, contrastRatio, googleFontFamilies, themeCssVars, toAntdTheme } from "./theme";
import { defaultTheme } from "@shared/schema";
import type { ColorScheme } from "@shared/schema";

/**
 * The palette's own contrast, checked as arithmetic.
 *
 * `e2e/accessibility.spec.ts` drives a real browser, which means it only ever
 * sees the scheme the seeded store happens to be set to — in practice light.
 * A shop that switches to dark gets a palette no browser in CI has rendered.
 * These are pure functions over a fixed table, so both schemes can be checked
 * here for the cost of a unit test, and an edit to `schemePalette` that dims a
 * colour past the threshold fails on the spot.
 */

/** WCAG 1.4.3, for body text at the sizes the storefront actually uses. */
const TEXT = 4.5;

const schemes: ColorScheme[] = ["light", "dark"];

describe.each(schemes)("the %s palette", (colorScheme) => {
  const vars = themeCssVars({ ...defaultTheme, colorScheme, colorPage: null });

  const ink = vars["--beluga-ink"] as string;
  const muted = vars["--beluga-muted"] as string;
  const page = vars["--beluga-page"] as string;
  const surface = vars["--beluga-surface"] as string;

  it.each([
    ["ink", ink, "page", page],
    ["ink", ink, "surface", surface],
    // Muted is the one that has been wrong before: antd derived a second,
    // dimmer grey beside it and put it under every Result subtitle at 2.9:1.
    ["muted", muted, "page", page],
    ["muted", muted, "surface", surface],
  ])("reads %s on %s", (_fg, foreground, _bg, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(TEXT);
  });

  it("keeps a badge legible on the accent it is painted on", () => {
    const accent = vars["--beluga-accent"] as string;
    expect(contrastRatio(vars["--beluga-on-accent"] as string, accent)).toBeGreaterThanOrEqual(TEXT);
  });

  it("keeps a primary button's label legible", () => {
    const primary = vars["--beluga-primary"] as string;
    expect(contrastRatio(vars["--beluga-on-primary"] as string, primary)).toBeGreaterThanOrEqual(
      TEXT,
    );
  });

  it("paints primary buttons the action yellow, with an ink label that reads on it", () => {
    const button = toAntdTheme({ ...defaultTheme, colorScheme, colorPage: null }).components?.Button;

    expect(button?.colorPrimary).toBe(ACTION_BUTTON.fill);
    expect(button?.primaryColor).toBe(ACTION_BUTTON.label);
    for (const fill of [ACTION_BUTTON.fill, ACTION_BUTTON.hover, ACTION_BUTTON.active]) {
      expect(contrastRatio(ACTION_BUTTON.label, fill)).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it("pins antd's secondary text to the palette rather than a derived grey", () => {
    const { token } = toAntdTheme({ ...defaultTheme, colorScheme, colorPage: null });

    // All three are one question — "what colour is de-emphasised text" — and
    // the palette already answers it. Letting antd fade `colorTextBase` by
    // alpha instead is what produced #949495 on #fafaf9.
    expect(token?.colorTextDescription).toBe(muted);
    expect(token?.colorTextSecondary).toBe(muted);
    expect(token?.colorTextTertiary).toBe(muted);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and 1:1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#e07a5f", "#e07a5f")).toBeCloseTo(1, 5);
  });

  it("does not care which way round the pair is given", () => {
    expect(contrastRatio("#18181b", "#fafaf9")).toBeCloseTo(contrastRatio("#fafaf9", "#18181b"), 10);
  });
});

describe("googleFontFamilies", () => {
  it("reads one family, axis spec and all, out of a css2 URL", () => {
    expect(
      googleFontFamilies("https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz@0,9&display=swap"),
    ).toEqual(["Fraunces"]);
  });

  it("reads every family out of a URL that names several", () => {
    expect(
      googleFontFamilies(
        "https://fonts.googleapis.com/css2?family=Fraunces&family=Inter:wght@400;700",
      ),
    ).toEqual(["Fraunces", "Inter"]);
  });

  it("is empty for a host other than Google Fonts", () => {
    expect(googleFontFamilies("https://example.com/css2?family=Fraunces")).toEqual([]);
  });

  it("is empty for a self-hosted stylesheet under /assets/", () => {
    expect(googleFontFamilies("/assets/fonts/fraunces.css")).toEqual([]);
  });

  it("is empty for a Google Fonts URL that isn't css2 — nothing to read a family out of", () => {
    expect(googleFontFamilies("https://fonts.googleapis.com/icon?family=Material+Icons")).toEqual(
      [],
    );
  });

  it("is empty for a string that is not a URL at all", () => {
    expect(googleFontFamilies("not a url")).toEqual([]);
  });
});

/*
 * Two things are deliberately not asserted here.
 *
 * A merchant's own `colorPage` is not, because they may set it to anything —
 * `ThemeEditor` warns them with this same function rather than refusing the
 * choice, and a store that wants an unreadable shop is entitled to one.
 *
 * `--beluga-line` is not, because it is 1.21:1 on the page in the light scheme
 * and is meant to be. It draws hairlines and dividers, which WCAG 1.4.11
 * exempts as decoration; the controls that do need a 3:1 boundary get theirs
 * from antd's own border tokens, and `e2e/accessibility.spec.ts` checks those
 * against a real render.
 */
