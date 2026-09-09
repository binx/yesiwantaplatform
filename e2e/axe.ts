import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";

/** Shared between `accessibility.spec.ts`'s sweep and any other spec that
 *  needs a one-off scan — `storefront-lock.spec.ts`'s gate, for one, which
 *  only ever sees the store locked and so cannot go through that sweep. */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

/**
 * Land every animation before measuring.
 *
 * axe reads the colour actually composited to the screen, so an element caught
 * part-way through a fade is measured at its transitional opacity and reported
 * as a contrast failure it does not have once it settles — antd's toasts and
 * its form help text both did this, intermittently and on one project only.
 * Zero duration rather than `animation: none`, so keyframes still apply their
 * end state instead of leaving the element where it started.
 */
export async function settleAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`,
  });

  /*
   * Zeroing the durations is not on its own enough: under a loaded machine the
   * animation is already in flight when the stylesheet lands, and axe can read
   * the element before the compositor catches up. antd's motion layer tags a
   * moving element with a `-appear-`/`-enter-`/`-leave-` state class and strips
   * it when the animation ends, so the absence of those is the signal that
   * everything on the page has reached its resting colour.
   */
  await expect(
    page.locator("[class*='-appear-'], [class*='-enter-'], [class*='-leave-']"),
  ).toHaveCount(0);
}

export async function scan(page: Page): Promise<AxeResults> {
  await settleAnimations(page);

  return (
    new AxeBuilder({ page })
      .withTags(TAGS)
      /*
       * WCAG 1.4.3 exempts text that is pure decoration, and axe has no way to
       * know which text that is. The only wearer of this attribute today is the
       * 404 watermark, whose <h1> says the same thing in ink — see
       * src/pages/NotFoundPage.tsx. Everything else is held to the ratio.
       */
      .exclude("[data-decorative-text]")
      .analyze()
  );
}

/** Names the offending element, rather than just failing with a count. */
export function report(results: AxeResults): string {
  return results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).join("\n    ")}`)
    .join("\n");
}
