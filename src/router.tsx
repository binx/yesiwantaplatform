import { createBrowserRouter } from "react-router-dom";
import { App, ShellFallback } from "./App";
import { LandingPage } from "./pages/LandingPage";
import { ShopPage } from "./pages/ShopPage";
import { CollectionPage } from "./pages/CollectionPage";
import { ProductPage } from "./pages/ProductPage";
import { CartPage } from "./pages/CartPage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { AboutPage } from "./pages/AboutPage";
import { PagePage } from "./pages/PagePage";
import { NotFoundPage } from "./pages/NotFoundPage";

/**
 * Routes are static.
 *
 * v1 generated one <Route> per product and per collection from the config,
 * so the router had to be rebuilt whenever the catalogue changed and a
 * product added in the admin had no route until a full page reload.
 *
 * The admin and the setup wizard are loaded on demand. They are a whole
 * second application — forms, tables, a colour picker — and no shopper should
 * download any of it to look at a product.
 */
/*
 * Every top-level route names one.
 *
 * react-router warns once per load in development when a tree containing
 * `lazy` routes has no `HydrateFallback` — noise on a working app, and the
 * kind a developer learns to scroll past, which is how the next warning gets
 * missed too. The shell's own waiting skeleton is the honest answer; a second,
 * different one would only be a different flash.
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
        // Public: the invitee has no session yet, so this sits outside the
        // pathless RequireAdmin branch below.
        path: "accept-invite",
        lazy: async () => ({
          Component: (await import("./admin/AcceptInvitePage")).AcceptInvitePage,
        }),
      },
      {
        // Pathless: everything below it is behind the session check.
        lazy: async () => ({ Component: (await import("./admin/RequireAdmin")).RequireAdmin }),
        children: [
          {
            index: true,
            lazy: async () => ({
              Component: (await import("./admin/DashboardPage")).DashboardPage,
            }),
          },
          {
            path: "products",
            lazy: async () => ({ Component: (await import("./admin/ProductsPage")).ProductsPage }),
          },
          {
            path: "products/new",
            lazy: async () => ({
              Component: (await import("./admin/ProductEditorPage")).ProductEditorPage,
            }),
          },
          {
            path: "products/:slug",
            lazy: async () => ({
              Component: (await import("./admin/ProductEditorPage")).ProductEditorPage,
            }),
          },
          {
            path: "collections",
            lazy: async () => ({
              Component: (await import("./admin/CollectionsPage")).CollectionsPage,
            }),
          },
          {
            path: "pages",
            lazy: async () => ({ Component: (await import("./admin/PagesPage")).PagesPage }),
          },
          {
            path: "pages/new",
            lazy: async () => ({
              Component: (await import("./admin/PagesPage")).PageEditorPage,
            }),
          },
          {
            path: "pages/:id",
            lazy: async () => ({
              Component: (await import("./admin/PagesPage")).PageEditorPage,
            }),
          },
          {
            path: "shipping",
            lazy: async () => ({ Component: (await import("./admin/ShippingPage")).ShippingPage }),
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
            path: "settings",
            lazy: async () => ({ Component: (await import("./admin/SettingsPage")).SettingsPage }),
          },
          {
            path: "users",
            lazy: async () => ({ Component: (await import("./admin/UsersPage")).UsersPage }),
          },
          {
            path: "webhooks",
            lazy: async () => ({
              Component: (await import("./admin/WebhooksPage")).WebhooksPage,
            }),
          },
          {
            // Without this an unknown /admin URL fell through to the root
            // "*" below and rendered the *storefront's* 404 — no sidebar, and
            // a "Back to the shop" button that does not go back to the admin.
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
      { path: "shop", element: <ShopPage /> },
      { path: "collection/:slug", element: <CollectionPage /> },
      { path: "product/:slug", element: <ProductPage /> },
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
      { path: "about", element: <AboutPage /> },
      {
        // Customer accounts, loaded on demand like /admin — a shopper who
        // never signs in downloads none of it.
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
            // Pathless: everything below it is behind the session check.
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
                path: "orders",
                lazy: async () => ({
                  Component: (await import("./pages/account/AccountOrdersPage")).AccountOrdersPage,
                }),
              },
              {
                path: "orders/:id",
                lazy: async () => ({
                  Component: (await import("./pages/account/AccountOrderDetailPage"))
                    .AccountOrderDetailPage,
                }),
              },
              {
                path: "addresses",
                lazy: async () => ({
                  Component: (await import("./pages/account/AccountAddressesPage"))
                    .AccountAddressesPage,
                }),
              },
            ],
          },
        ],
      },
      /*
       * Merchant-authored pages, matched last.
       *
       * A bare `:slug` is as greedy as it looks — put it any higher and it
       * captures /shop, /cart and every other static route above. React Router
       * ranks a static segment above a dynamic one regardless of order, but
       * relying on that would make the ordering here look arbitrary; the API
       * also refuses to save a page at any of those slugs, so the two agree.
       */
      { path: ":slug", element: <PagePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
