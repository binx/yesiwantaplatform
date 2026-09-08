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
 */
function ThemeVars() {
  const { theme } = useStore();

  useEffect(() => {
    const root = document.documentElement;

    for (const [name, value] of Object.entries(themeCssVars(theme))) {
      root.style.setProperty(name, value);
    }
    root.dataset.colorScheme = theme.colorScheme;
  }, [theme]);

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

function ShellFallback() {
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
