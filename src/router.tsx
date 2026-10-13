import { createBrowserRouter, Navigate } from "react-router-dom";
import { App, ShellFallback } from "./App";
import { LandingPage } from "./pages/LandingPage";
import { ArtistsPage } from "./pages/ArtistsPage";
import { ArtistPage } from "./pages/ArtistPage";
import { EditionPage } from "./pages/EditionPage";
import { GalleryPage } from "./pages/GalleryPage";
import { ForArtistsPage } from "./pages/ForArtistsPage";
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
          { path: "review", lazy: async () => ({ Component: (await import("./admin/ReviewPage")).ReviewPage }) },
          { path: "artists", lazy: async () => ({ Component: (await import("./admin/ArtistsPage")).ArtistsPage }) },
          { path: "artists/:id", lazy: async () => ({ Component: (await import("./admin/ArtistDetailPage")).ArtistDetailPage }) },
          { path: "editions", lazy: async () => ({ Component: (await import("./admin/EditionsPage")).EditionsPage }) },
          { path: "editions/:id", lazy: async () => ({ Component: (await import("./admin/EditionDetailPage")).EditionDetailPage }) },
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
      { path: "artist/:slug", element: <ArtistPage /> },
      { path: "artist/:slug/:edition", element: <EditionPage /> },
      { path: "gallery", element: <GalleryPage /> },
      { path: "how-it-works", element: <ForArtistsPage /> },
      { path: "open-a-studio", element: <Navigate to="/how-it-works" replace /> },
      {
        // The collect flow needs a sign-in; its own chunk.
        path: "collect/:slug/:edition",
        lazy: async () => ({ Component: (await import("./pages/CollectPage")).CollectPage }),
      },
      {
        path: "collect/confirm",
        lazy: async () => ({ Component: (await import("./pages/CollectConfirmPage")).CollectConfirmPage }),
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
              { index: true, lazy: async () => ({ Component: (await import("./pages/account/AccountSettingsPage")).AccountSettingsPage }) },
              { path: "collections", lazy: async () => ({ Component: (await import("./pages/account/AccountCollectionsPage")).AccountCollectionsPage }) },
              { path: "collections/:id", lazy: async () => ({ Component: (await import("./pages/account/AccountCollectionPage")).AccountCollectionPage }) },
              // Where these used to be, for old links and bookmarks.
              { path: "postcards", element: <Navigate to="/account/collections" replace /> },
              { path: "settings", element: <Navigate to="/account" replace /> },
              { path: "address", element: <Navigate to="/account" replace /> },
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
          { path: "new", lazy: async () => ({ Component: (await import("./pages/studio/StudioSetupPage")).StudioSetupPage }) },
          { path: "profile", lazy: async () => ({ Component: (await import("./pages/studio/StudioProfilePage")).StudioProfilePage }) },
          { path: "editions", lazy: async () => ({ Component: (await import("./pages/studio/StudioEditionsPage")).StudioEditionsPage }) },
          { path: "editions/new", lazy: async () => ({ Component: (await import("./pages/studio/StudioEditionPage")).StudioNewEditionPage }) },
          { path: "editions/:id", lazy: async () => ({ Component: (await import("./pages/studio/StudioEditionPage")).StudioEditionPage }) },
        ],
      },
      // Operator-authored pages, matched last. A bare `:slug` is greedy, and
      // the API refuses to save a page at any of the static routes above.
      { path: ":slug", element: <PagePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
