import { createBrowserRouter } from "react-router-dom";
import { App, ShellFallback } from "./App";
import { LandingPage } from "./pages/LandingPage";
import { ArtistsPage } from "./pages/ArtistsPage";
import { ArtistPage } from "./pages/ArtistPage";
import { GalleryPage } from "./pages/GalleryPage";
import { PagePage } from "./pages/PagePage";
import { NotFoundPage } from "./pages/NotFoundPage";

/**
 * Routes are static.
 *
 * The admin, the setup wizard, the account and the studio are loaded on
 * demand. A visitor reading an artist's page downloads none of the forms,
 * tables and colour pickers the other three are made of.
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
      { path: "login", lazy: async () => ({ Component: (await import("./admin/LoginPage")).LoginPage }) },
      { path: "forgot-password", lazy: async () => ({ Component: (await import("./admin/ForgotPasswordPage")).ForgotPasswordPage }) },
      { path: "reset-password", lazy: async () => ({ Component: (await import("./admin/ResetPasswordPage")).ResetPasswordPage }) },
      {
        // Pathless: everything below it is behind the session check.
        lazy: async () => ({ Component: (await import("./admin/RequireAdmin")).RequireAdmin }),
        children: [
          { index: true, lazy: async () => ({ Component: (await import("./admin/DashboardPage")).DashboardPage }) },
          { path: "artists", lazy: async () => ({ Component: (await import("./admin/ArtistsPage")).ArtistsPage }) },
          { path: "artists/:id", lazy: async () => ({ Component: (await import("./admin/ArtistDetailPage")).ArtistDetailPage }) },
          { path: "mailings", lazy: async () => ({ Component: (await import("./admin/MailingsPage")).MailingsPage }) },
          { path: "mailings/:id", lazy: async () => ({ Component: (await import("./admin/MailingDetailPage")).MailingDetailPage }) },
          { path: "payouts", lazy: async () => ({ Component: (await import("./admin/PayoutsPage")).PayoutsPage }) },
          { path: "customers", lazy: async () => ({ Component: (await import("./admin/CustomersPage")).CustomersPage }) },
          { path: "pages", lazy: async () => ({ Component: (await import("./admin/PagesPage")).PagesPage }) },
          { path: "pages/new", lazy: async () => ({ Component: (await import("./admin/PagesPage")).PageEditorPage }) },
          { path: "pages/:id", lazy: async () => ({ Component: (await import("./admin/PagesPage")).PageEditorPage }) },
          { path: "settings", lazy: async () => ({ Component: (await import("./admin/SettingsPage")).SettingsPage }) },
          { path: "*", lazy: async () => ({ Component: (await import("./admin/AdminNotFoundPage")).AdminNotFoundPage }) },
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
      { path: "artists", element: <ArtistsPage /> },
      { path: "a/:slug", element: <ArtistPage /> },
      { path: "gallery", element: <GalleryPage /> },
      {
        // The subscribe flow needs a sign-in; its own chunk.
        path: "subscribe/:slug",
        lazy: async () => ({ Component: (await import("./pages/SubscribePage")).SubscribePage }),
      },
      {
        path: "subscribe/confirm",
        lazy: async () => ({ Component: (await import("./pages/SubscribeConfirmPage")).SubscribeConfirmPage }),
      },
      {
        // Customer accounts, loaded on demand like /admin.
        path: "account",
        children: [
          { path: "login", lazy: async () => ({ Component: (await import("./pages/account/AccountLoginPage")).AccountLoginPage }) },
          { path: "register", lazy: async () => ({ Component: (await import("./pages/account/AccountRegisterPage")).AccountRegisterPage }) },
          { path: "verify", lazy: async () => ({ Component: (await import("./pages/account/VerifyEmailPage")).VerifyEmailPage }) },
          { path: "forgot-password", lazy: async () => ({ Component: (await import("./pages/account/ForgotPasswordPage")).ForgotPasswordPage }) },
          { path: "reset-password", lazy: async () => ({ Component: (await import("./pages/account/ResetPasswordPage")).ResetPasswordPage }) },
          {
            lazy: async () => ({ Component: (await import("./pages/account/RequireCustomer")).RequireCustomer }),
            children: [
              { index: true, lazy: async () => ({ Component: (await import("./pages/account/AccountOverviewPage")).AccountOverviewPage }) },
              { path: "postcards", lazy: async () => ({ Component: (await import("./pages/account/AccountPostcardsPage")).AccountPostcardsPage }) },
              { path: "address", lazy: async () => ({ Component: (await import("./pages/account/AccountAddressPage")).AccountAddressPage }) },
              { path: "receipts", lazy: async () => ({ Component: (await import("./pages/account/AccountOrdersPage")).AccountOrdersPage }) },
            ],
          },
        ],
      },
      {
        // The artist's studio: a customer session plus an artist page.
        path: "studio",
        lazy: async () => ({ Component: (await import("./pages/studio/RequireArtist")).RequireArtist }),
        children: [
          { index: true, lazy: async () => ({ Component: (await import("./pages/studio/StudioOverviewPage")).StudioOverviewPage }) },
          { path: "new", lazy: async () => ({ Component: (await import("./pages/studio/StudioProfilePage")).StudioNewPage }) },
          { path: "profile", lazy: async () => ({ Component: (await import("./pages/studio/StudioProfilePage")).StudioProfilePage }) },
          { path: "queue", lazy: async () => ({ Component: (await import("./pages/studio/StudioQueuePage")).StudioQueuePage }) },
          { path: "subscribers", lazy: async () => ({ Component: (await import("./pages/studio/StudioSubscribersPage")).StudioSubscribersPage }) },
          { path: "earnings", lazy: async () => ({ Component: (await import("./pages/studio/StudioEarningsPage")).StudioEarningsPage }) },
        ],
      },
      // Operator-authored pages, matched last. A bare `:slug` is greedy, and
      // the API refuses to save a page at any of the static routes above.
      { path: ":slug", element: <PagePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
