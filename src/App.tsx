import { Suspense, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { App as AntApp, ConfigProvider, Skeleton } from "antd";
import { Banner } from "@/components/layout/Banner";
import { Footer } from "@/components/layout/Footer";
import { ScrollToTop } from "@/components/layout/ScrollToTop";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { StoreErrorBoundary } from "@/components/layout/StoreErrorBoundary";
import { useStore } from "@/lib/useStore";
import { themeCssVars, toAntdTheme } from "@/lib/theme";
import { useCartRecoverySync } from "@/lib/useCartRecoverySync";
import { FONT_LINK_ID, languageOf } from "@shared/locale";

function DocumentTitle() {
  const store = useStore();

  useEffect(() => {
    document.title = store.name;
  }, [store.name]);

  return null;
}

/**
 * Publishes the store's theme to CSS custom properties on :root.
 *
 * antd's ConfigProvider only reaches antd's own components; every CSS Module in
 * the storefront reads `--beluga-*`. Without this the two halves disagreed, and
 * the stylesheet half always won.
 *
 * It also loads the theme's font and sets the document language, for the same
 * reason: neither can be written into `index.html` at build time, because both
 * are values the merchant picks long after the bundle was built.
 */
function ThemeVars() {
  const { theme, locale } = useStore();

  useEffect(() => {
    const root = document.documentElement;

    for (const [name, value] of Object.entries(themeCssVars(theme))) {
      root.style.setProperty(name, value);
    }
    root.dataset.colorScheme = theme.colorScheme;
  }, [theme]);

  useEffect(() => {
    /*
     * Found by id rather than created unconditionally: in production the HTML
     * handler has already put this link in the head, so the font starts
     * downloading before React boots. Creating a second one would fetch the
     * same stylesheet twice and leave the server's copy behind on a change.
     */
    const existing = document.head.querySelector<HTMLLinkElement>(`#${FONT_LINK_ID}`);

    if (!theme.fontUrl) {
      // Removed, not blanked: a `<link>` with an empty href resolves to the
      // current page, which asks the server for the HTML document as CSS.
      existing?.remove();
      return;
    }

    const link = existing ?? document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    // Compared before assigning: setting `href` to what it already is re-fetches
    // the stylesheet and flashes the fallback face while it lands.
    if (link.getAttribute("href") !== theme.fontUrl) link.href = theme.fontUrl;
    if (!existing) document.head.append(link);
  }, [theme.fontUrl]);

  useEffect(() => {
    // `lang` drives screen-reader pronunciation and the browser's offer to
    // translate. The built shell ships `en`, which is a guess about something
    // the store has now been asked directly.
    document.documentElement.lang = languageOf(locale);
  }, [locale]);

  return null;
}

/**
 * Themed shell.
 *
 * The store config gates rendering via Suspense, so children receive a
 * non-nullable store. v1 returned `null` from App until config arrived, which
 * left every consumer defensively checking for it.
 */
function ThemedShell() {
  const store = useStore();
  useCartRecoverySync();

  return (
    <ConfigProvider theme={toAntdTheme(store.theme)}>
      <AntApp>
        <ThemeVars />
        <DocumentTitle />
        <ScrollToTop />
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Banner />
        <main id="main">
          <Outlet />
        </main>
        <Footer />
      </AntApp>
    </ConfigProvider>
  );
}

/**
 * The shell while the store config is still in flight.
 *
 * Exported because the router uses it as `HydrateFallback` too: react-router
 * warns on every development load when a route tree with `lazy` children has
 * none, and the honest fallback is the one the app already shows while it is
 * waiting — not a second, different skeleton.
 */
export function ShellFallback() {
  return (
    <PageWrapper>
      <Skeleton active paragraph={{ rows: 6 }} />
    </PageWrapper>
  );
}

export function App() {
  return (
    <StoreErrorBoundary>
      <Suspense fallback={<ShellFallback />}>
        <ThemedShell />
      </Suspense>
    </StoreErrorBoundary>
  );
}
