import { createBrowserRouter } from "react-router-dom";
import { App, ShellFallback } from "./App";
import { LandingPage } from "./pages/LandingPage";
import { CreatePage } from "./pages/CreatePage";
import { CartPage } from "./pages/CartPage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { PagePage } from "./pages/PagePage";
import { NotFoundPage } from "./pages/NotFoundPage";

/**
 * Routes are static.
 *
 * The admin and the setup wizard are loaded on demand. They are a whole
 * second application — forms, tables, a colour picker — and no shopper should
 * download any of it to design a postcard.
 */
const HydrateFallback = ShellFallback;

export const router = createBrowserRouter([
  {
    path: "/setup",
    HydrateFallback,
    lazy: async () => ({ Component: (await import("./admin/SetupPage")).SetupPage }),
  },
  {
    path: "/admin",
    HydrateFallback,
    lazy: async () => ({ Component: (await import("./admin/AdminRoot")).AdminRoot }),
    children: [
      {
        path: "login",
        lazy: async () => ({ Component: (await import("./admin/LoginPage")).LoginPage }),
      },
      {
        // Public: the caller cannot sign in, that is why they are here.
        path: "forgot-password",
        lazy: async () => ({
          Component: (await import("./admin/ForgotPasswordPage")).ForgotPasswordPage,
        }),
      },
      {
        path: "reset-password",
        lazy: async () => ({
          Component: (await import("./admin/ResetPasswordPage")).ResetPasswordPage,
        }),
      },
      {
        // Pathless: everything below it is behind the session check.
        lazy: async () => ({ Component: (await import("./admin/RequireAdmin")).RequireAdmin }),
        children: [
          {
            index: true,
            lazy: async () => ({ Component: (await import("./admin/DashboardPage")).DashboardPage }),
          },
          {
            path: "orders",
            lazy: async () => ({ Component: (await import("./admin/OrdersPage")).OrdersPage }),
          },
          {
            path: "orders/:id",
            lazy: async () => ({
              Component: (await import("./admin/OrderDetailPage")).OrderDetailPage,
            }),
          },
          {
            path: "pages",
            lazy: async () => ({ Component: (await import("./admin/PagesPage")).PagesPage }),
          },
          {
            path: "pages/new",
            lazy: async () => ({ Component: (await import("./admin/PagesPage")).PageEditorPage }),
          },
          {
            path: "pages/:id",
            lazy: async () => ({ Component: (await import("./admin/PagesPage")).PageEditorPage }),
          },
          {
            path: "settings",
            lazy: async () => ({ Component: (await import("./admin/SettingsPage")).SettingsPage }),
          },
          {
            path: "*",
            lazy: async () => ({
              Component: (await import("./admin/AdminNotFoundPage")).AdminNotFoundPage,
            }),
          },
        ],
      },
    ],
  },
  {
    path: "/",
    element: <App />,
    HydrateFallback,
    children: [
      { index: true, element: <LandingPage /> },
      { path: "create", element: <CreatePage /> },
      { path: "cart", element: <CartPage /> },
      { path: "confirm", element: <ConfirmPage /> },
      {
        // Reached from a cart-reminder email; a shopper who never gets one
        // downloads none of it.
        path: "unsubscribe",
        lazy: async () => ({
          Component: (await import("./pages/UnsubscribeCartRecoveryPage")).UnsubscribeCartRecoveryPage,
        }),
      },
      {
        // A friend's "send me your address" link. Public, and its own small
        // chunk: the person opening it is not a customer and downloads none
        // of the account.
        path: "address/:token",
        lazy: async () => ({ Component: (await import("./pages/AddressRequestPage")).AddressRequestPage }),
      },
      { path: "about", element: <PagePage slug="about" /> },
      {
        // Customer accounts, loaded on demand like /admin.
        path: "account",
        children: [
          {
            path: "login",
            lazy: async () => ({
              Component: (await import("./pages/account/AccountLoginPage")).AccountLoginPage,
            }),
          },
          {
            path: "register",
            lazy: async () => ({
              Component: (await import("./pages/account/AccountRegisterPage")).AccountRegisterPage,
            }),
          },
          {
            path: "verify",
            lazy: async () => ({
              Component: (await import("./pages/account/VerifyEmailPage")).VerifyEmailPage,
            }),
          },
          {
            path: "forgot-password",
            lazy: async () => ({
              Component: (await import("./pages/account/ForgotPasswordPage")).ForgotPasswordPage,
            }),
          },
          {
            path: "reset-password",
            lazy: async () => ({
              Component: (await import("./pages/account/ResetPasswordPage")).ResetPasswordPage,
            }),
          },
          {
            lazy: async () => ({
              Component: (await import("./pages/account/RequireCustomer")).RequireCustomer,
            }),
            children: [
              {
                index: true,
                lazy: async () => ({
                  Component: (await import("./pages/account/AccountOverviewPage")).AccountOverviewPage,
                }),
              },
              {
                path: "postcards",
                lazy: async () => ({
                  Component: (await import("./pages/account/AccountPostcardsPage")).AccountPostcardsPage,
                }),
              },
              {
                path: "postcards/:id",
                lazy: async () => ({
                  Component: (await import("./pages/account/AccountPostcardDetailPage")).AccountPostcardDetailPage,
                }),
              },
              {
                path: "orders",
                lazy: async () => ({
                  Component: (await import("./pages/account/AccountOrdersPage")).AccountOrdersPage,
                }),
              },
              {
                path: "orders/:id",
                lazy: async () => ({
                  Component: (await import("./pages/account/AccountOrderDetailPage")).AccountOrderDetailPage,
                }),
              },
              {
                path: "recipients",
                lazy: async () => ({
                  Component: (await import("./pages/account/AccountAddressesPage")).AccountAddressesPage,
                }),
              },
            ],
          },
        ],
      },
      // Merchant-authored pages, matched last. A bare `:slug` is greedy, and
      // the API refuses to save a page at any of the static routes above.
      { path: ":slug", element: <PagePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
