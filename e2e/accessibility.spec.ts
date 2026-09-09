import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 4's accessibility gate.
 *
 * The structural work — real `<img>` with alt text, labelled controls,
 * keyboard-reachable buttons, landmarks, a skip link — landed across earlier
 * phases, but nothing stopped the next change from undoing it. This is that
 * something. It runs under both Playwright projects, so every route below is
 * checked at desktop width and again on a Pixel 7.
 *
 * It is deliberately not a Lighthouse run. Lighthouse scores a page out of 100
 * from a weighted subset of these same axe rules, so "≥ 95" tolerates a real
 * failure as long as the rest of the page pulls the average up. A violation
 * count does not average, and it names the element.
 */

/*
 * One thing this file does not cover, recorded so the gap is visible rather
 * than merely absent: the admin behind the session check. Phase 5's screens are
 * tables, modals, a drag-and-drop image manager and a colour picker, and
 * auditing them is its own piece of work rather than a rider on this one.
 * `/admin/login` and `/admin/accept-invite` are public, so they are covered
 * here, and the setup wizard is covered at the bottom of this file.
 */

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
async function settleAnimations(page: Page) {
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

async function scan(page: Page) {
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
function report(results: Awaited<ReturnType<typeof scan>>) {
  return results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).join("\n    ")}`)
    .join("\n");
}

const routes: [name: string, path: string][] = [
  ["landing", "/"],
  ["shop", "/shop"],
  ["collection", "/collection/home-goods"],
  ["product with variants", "/product/canvas-tote"],
  ["product without variants", "/product/enamel-mug"],
  ["empty cart", "/cart"],
  ["merchant page", "/about"],
  ["404", "/no-such-page-here"],
  ["customer sign-in", "/account/login"],
  ["customer registration", "/account/register"],
  ["forgot password", "/account/forgot-password"],
  ["reset password", "/account/reset-password?token=not-a-real-token"],
  ["order confirmation", "/confirm"],
  ["cart-email unsubscribe", "/unsubscribe"],
  ["admin sign-in", "/admin/login"],
  // The token is only spent on submit, so an invalid one still renders the
  // form — which is the thing being audited. A missing one redirects away.
  ["admin invitation", "/admin/accept-invite?token=not-a-real-token"],
];

for (const [name, path] of routes) {
  test(`${name} has no accessibility violations`, async ({ page }) => {
    await page.goto(path);
    /*
     * Wait for the page's own <h1>, not merely for the shell.
     *
     * Two skeletons stand between a navigation and the finished page: the
     * shell's, until the store snapshot arrives, and `PagePage`'s, until a
     * merchant page's body does. Scanning either audits antd's placeholder
     * instead of the page — which reports an empty <h3> and a missing <h1>,
     * both of which belong to the skeleton and neither of which is a bug in
     * the route under test. A level-one heading is the first thing that is
     * only true once the real content is mounted.
     */
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const found = report(await scan(page));
    expect(found, found).toBe("");
  });
}

/*
 * The routes above are all first paint. These are the states a shopper reaches
 * by doing something — where a live region, a focus trap or a dialog exists at
 * all — and they are where an accessibility regression is most likely to hide.
 */

test("a cart holding a line has no accessibility violations", async ({ page }) => {
  await page.goto("/product/canvas-tote");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForURL(/\/cart$/);
  await expect(page.getByText("Subtotal")).toBeVisible();

  const found = report(await scan(page));
  expect(found, found).toBe("");
});

test("the mobile nav drawer has no accessibility violations", async ({ page }) => {
  await page.goto("/");
  // Before the shell mounts there is no menu button to be visible, and asking
  // too early skipped this test under the mobile project too — where it is the
  // whole point of the test.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const menu = page.getByRole("button", { name: "Open menu" });
  // The drawer is CSS-gated, so it exists only under the mobile project. There
  // is nothing to assert at desktop width, and skipping says so out loud.
  test.skip(!(await menu.isVisible()), "the drawer is mobile-only");

  await menu.click();
  await expect(page.getByRole("dialog")).toBeVisible();

  const found = report(await scan(page));
  expect(found, found).toBe("");
});

test("the storefront's first tab stop is the skip link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner")).toBeVisible();

  /*
   * A skip link that is present but not first is no skip link: the whole point
   * is to precede the nav a keyboard user would otherwise tab through. It is
   * off-screen until focused, so the check is that focusing it reveals it.
   */
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();

  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeVisible();
});

/*
 * The setup wizard.
 *
 * `/setup` redirects away the moment a store is configured, and this suite runs
 * against a seeded one — so for a long time nothing here reached the wizard,
 * and it was scanned only by accident, when a worktree's database happened to
 * have no admin and `/admin/login` redirected onto it. It was not clean when
 * that happened: the wizard is a sibling of `/admin` in the router rather than
 * a child, so it never saw `AdminRoot`'s `ConfigProvider` and rendered under
 * antd's stock theme, whose muted grey and default blue both fail AA.
 *
 * Reaching it deliberately needs a store with no admin. Rather than a second
 * database — `playwright.config.ts` points the API at the real
 * `data/beluga.sqlite`, and these tests run in parallel with everything above —
 * the single endpoint the page branches on is stubbed per test. Nothing is
 * written and no other test's view of the world changes.
 */

/** `GET /api/setup` for a store nobody has claimed yet. */
const UNCONFIGURED = {
  needsSetup: true,
  hasAdmin: false,
  hasSettings: false,
  hasStripeSecret: false,
  stripeMode: null,
  requiresToken: false,
  // A first run on a laptop, which is what makes the wizard's "still localhost"
  // warning render on the last step. Leaving it out silently skipped that Alert.
  publicUrl: "http://localhost:5173",
};

async function openWizard(page: Page, status: Record<string, unknown> = {}) {
  await page.route("**/api/setup", async (route) => {
    // Only the status read is faked. A POST here is the real submit, and
    // letting it through rather than swallowing it means a test that
    // accidentally reaches one fails loudly instead of appearing to pass.
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { ...UNCONFIGURED, ...status } });
  });

  await page.goto("/setup");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Fills step 1 and advances, so the later steps can be reached at all. */
async function completeIdentityStep(page: Page) {
  const password = "a-sufficiently-long-password";

  await page.getByLabel("Store name").fill("Accessibility Test Store");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
}

test("the setup wizard's store step has no accessibility violations", async ({ page }) => {
  await openWizard(page);
  await expect(page.getByLabel("Store name")).toBeVisible();

  const found = report(await scan(page));
  expect(found, found).toBe("");
});

test("the setup wizard's setup-token field has no accessibility violations", async ({ page }) => {
  // A production deploy, where the wizard is public until someone claims it.
  await openWizard(page, { requiresToken: true });
  await expect(page.getByLabel("Setup token")).toBeVisible();

  const found = report(await scan(page));
  expect(found, found).toBe("");
});

test("the setup wizard's payments step has no accessibility violations", async ({ page }) => {
  await openWizard(page);
  await completeIdentityStep(page);
  await expect(page.getByPlaceholder("pk_test_…")).toBeVisible();

  const found = report(await scan(page));
  expect(found, found).toBe("");
});

test("the setup wizard's live-key warning has no accessibility violations", async ({ page }) => {
  // The loudest thing the wizard can say, and a different render path: a
  // success Alert carrying a Tag rather than the info Alert above.
  await openWizard(page, { hasStripeSecret: true, stripeMode: "live" });
  await completeIdentityStep(page);
  await expect(page.getByText("live mode")).toBeVisible();

  const found = report(await scan(page));
  expect(found, found).toBe("");
});

test("the setup wizard's theme step has no accessibility violations", async ({ page }) => {
  await openWizard(page);
  await completeIdentityStep(page);
  await expect(page.getByPlaceholder("pk_test_…")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // The colour picker, the typeface select and the radius slider — the three
  // controls that are not plain inputs, and the ones worth scanning.
  await expect(page.getByText("Preview")).toBeVisible();
  await expect(page.getByText("This server's public URL is still localhost")).toBeVisible();

  const found = report(await scan(page));
  expect(found, found).toBe("");
});
