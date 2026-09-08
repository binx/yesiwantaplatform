import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider } from "antd";
import type { Store } from "@shared/schema";
import { storeQueryKey } from "@/lib/useStore";

interface ProviderOptions {
  /**
   * Seed the store query so a component using `useStore` renders without
   * suspending on a fetch. Suspense makes the store non-nullable at the type
   * level, so there is no "not loaded yet" branch to render instead.
   */
  store?: Store;
  /** Initial URL, for components that read `?q=` and friends. */
  route?: string;
}

function makeProviders({ store, route }: ProviderOptions) {
  return function Providers({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    if (store) queryClient.setQueryData(storeQueryKey, store);

    return (
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <AntApp>
            <MemoryRouter initialEntries={[route ?? "/"]}>{children}</MemoryRouter>
          </AntApp>
        </ConfigProvider>
      </QueryClientProvider>
    );
  };
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper"> & ProviderOptions,
) {
  const { store, route, ...renderOptions } = options ?? {};

  return render(ui, {
    wrapper: makeProviders({
      ...(store ? { store } : {}),
      ...(route ? { route } : {}),
    }),
    ...renderOptions,
  });
}

export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
