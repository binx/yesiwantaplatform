import { Suspense, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { App as AntApp, ConfigProvider, Skeleton } from "antd";
import { Banner } from "@/components/layout/Banner";
import { ScrollToTop } from "@/components/layout/ScrollToTop";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { StoreErrorBoundary } from "@/components/layout/StoreErrorBoundary";
import { useStore } from "@/lib/useStore";
import { toAntdTheme } from "@/lib/theme";

function DocumentTitle() {
  const store = useStore();

  useEffect(() => {
    document.title = store.name;
  }, [store.name]);

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

  return (
    <ConfigProvider theme={toAntdTheme(store.theme)}>
      <AntApp>
        <DocumentTitle />
        <ScrollToTop />
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Banner />
        <main id="main">
          <Outlet />
        </main>
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
