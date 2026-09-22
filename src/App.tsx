import { Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { App as AntApp, ConfigProvider, Skeleton } from "antd";
import { Banner } from "@/components/layout/Banner";
import { Footer } from "@/components/layout/Footer";
import { ScrollToTop } from "@/components/layout/ScrollToTop";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { StoreErrorBoundary } from "@/components/layout/StoreErrorBoundary";
import { useStore } from "@/lib/useStore";
import { themeCssVars, toAntdTheme } from "@/lib/theme";
import { FONT_LINK_ID, languageOf } from "@shared/locale";
import { SITE_TITLE } from "@shared/site";

/** Every route is titled the same; see shared/site.ts. */
function DocumentTitle() {
  useEffect(() => {
    document.title = SITE_TITLE;
  }, []);

  return null;
}

/**
 * Publishes the platform's theme to CSS custom properties on :root.
 *
 * antd's ConfigProvider only reaches antd's own components; every CSS Module
 * in the site reads `--beluga-*`. It also loads the theme's font and sets the
 * document language, because both are values the operator picks long after
 * the bundle was built.
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
     * downloading before React boots.
     */
    const existing = document.head.querySelector<HTMLLinkElement>(`#${FONT_LINK_ID}`);

    if (!theme.fontUrl) {
      existing?.remove();
      return;
    }

    const link = existing ?? document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    if (link.getAttribute("href") !== theme.fontUrl) link.href = theme.fontUrl;
    if (!existing) document.head.append(link);
  }, [theme.fontUrl]);

  useEffect(() => {
    document.documentElement.lang = languageOf(locale);
  }, [locale]);

  return null;
}

/**
 * Themed shell.
 *
 * The platform config gates rendering via Suspense, so children receive a
 * non-nullable store.
 */
function ThemedShell() {
  const store = useStore();
  // The front page is the one route that draws its own navigation, inside
  // its hero; the site header would sit on top of it as a plain grey stripe.
  const { pathname } = useLocation();
  const showBanner = pathname !== "/";

  return (
    <ConfigProvider theme={toAntdTheme(store.theme)}>
      <AntApp>
        <ThemeVars />
        <DocumentTitle />
        <ScrollToTop />
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {showBanner ? <Banner /> : null}
        <main id="main">
          <Outlet />
        </main>
        <Footer />
      </AntApp>
    </ConfigProvider>
  );
}

/** The shell while the platform config is still in flight. Also the router's `HydrateFallback`. */
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
