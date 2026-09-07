import { createBrowserRouter } from "react-router-dom";
import { App } from "./App";
import { LandingPage } from "./pages/LandingPage";
import { ShopPage } from "./pages/ShopPage";
import { CollectionPage } from "./pages/CollectionPage";
import { ProductPage } from "./pages/ProductPage";
import { CartPage } from "./pages/CartPage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { AboutPage } from "./pages/AboutPage";
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
export const router = createBrowserRouter([
  {
    path: "/setup",
    lazy: async () => ({ Component: (await import("./admin/SetupPage")).SetupPage }),
  },
  {
    path: "/admin",
    lazy: async () => ({ Component: (await import("./admin/AdminRoot")).AdminRoot }),
    children: [
      {
        path: "login",
        lazy: async () => ({ Component: (await import("./admin/LoginPage")).LoginPage }),
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
        ],
      },
    ],
  },
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: "shop", element: <ShopPage /> },
      { path: "collection/:slug", element: <CollectionPage /> },
      { path: "product/:slug", element: <ProductPage /> },
      { path: "cart", element: <CartPage /> },
      { path: "confirm", element: <ConfirmPage /> },
      { path: "about", element: <AboutPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
