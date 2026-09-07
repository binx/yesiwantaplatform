import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./lib/api";
import { StoreNotSetUpError } from "./lib/store-source";
import { router } from "./router";
import "./index.css";

/**
 * Don't retry an answer that will not change.
 *
 * A store that has not been set up answers 503 with `needsSetup`, and a
 * signed-out admin answers 401. Retrying either is pointless, and it is worse
 * than pointless under Suspense: the query stays `pending` for the whole retry
 * schedule, so `App` holds its skeleton instead of letting the error reach
 * `StoreErrorBoundary`. A fresh clone would sit on a loading state forever
 * rather than showing the setup wizard.
 */
function retry(failureCount: number, error: unknown): boolean {
  if (error instanceof StoreNotSetUpError) return false;
  // 4xx is the caller's problem and will not fix itself.
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry,
      refetchOnWindowFocus: false,
      /*
       * Beluga talks to its own origin, so `navigator.onLine` — which reports
       * "online" for any local network and is wrong often enough in embedded
       * webviews — tells us nothing useful about whether the API is reachable.
       * Left on the default, a false reading pauses every query indefinitely,
       * which under Suspense is an unexplained blank page. Let requests fail
       * honestly and surface the error instead.
       */
      networkMode: "always",
    },
    mutations: { networkMode: "always" },
  },
});

const container = document.getElementById("root");
if (!container) throw new Error('No #root element found in index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
