import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, Button, Typography } from "antd";
import { StoreNotSetUpError } from "@/lib/store-source";
import { PageWrapper } from "./PageWrapper";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches failures loading the store.
 *
 * Two states are worth telling apart: a store that exists but is unreachable,
 * and a store that has never been set up. v1 conflated everything into a blank
 * page, because App returned `null` until config arrived and there was no
 * error path at all.
 */
export class StoreErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Failed to load the store:", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (error instanceof StoreNotSetUpError || error.name === "StoreNotSetUpError") {
      return (
        <PageWrapper width="prose">
          <h1>Welcome to Beluga</h1>
          <p>
            This store has not been set up yet. The wizard takes three steps and ends with you
            signed in to the admin.
          </p>
          <p>
            <Button type="primary" href="/setup">
              Set up this store
            </Button>
          </p>
          <Typography.Paragraph type="secondary">
            Prefer a terminal? <code>npm run setup</code> does the same thing, and can also validate
            a Stripe secret key before writing it to <code>.env</code>.
          </Typography.Paragraph>
        </PageWrapper>
      );
    }

    return (
      <PageWrapper width="prose">
        <Alert
          type="error"
          showIcon
          title="Couldn't load this store"
          description={
            <>
              <p style={{ marginTop: 0 }}>
                The storefront could not reach its API. If you are developing locally, check that
                the API is running:
              </p>
              <pre style={{ margin: 0 }}>npm run dev:all</pre>
            </>
          }
        />
        <p style={{ marginTop: "1.5rem" }}>
          <Button onClick={() => window.location.reload()}>Try again</Button>
        </p>
      </PageWrapper>
    );
  }
}
