import { useEffect } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { ApiError } from "@/lib/api";
import { useLogin, useSession } from "@/lib/session";
import { cx } from "@/lib/cx";
import styles from "./LoginPage.module.css";

interface LocationState {
  from?: string;
}

/**
 * Sign in.
 *
 * The API answers a wrong password and an unknown account identically, and so
 * does this page — there is no "no account with that email" path to leak the
 * customer list of a store back to whoever is guessing.
 */
export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const login = useLogin();

  const from = (location.state as LocationState | null)?.from;
  const destination = from && from.startsWith("/admin") ? from : "/admin";

  useEffect(() => {
    document.title = "Sign in · Beluga";
  }, []);

  // Already signed in — bounce straight through rather than showing a form
  // that would immediately succeed.
  if (session.data?.isAdmin) return <Navigate to={destination} replace />;
  if (session.data && !session.data.isConfigured) return <Navigate to="/setup" replace />;

  const rateLimited = login.error instanceof ApiError && login.error.status === 429;

  return (
    <div className={cx(styles.page)}>
      <Card className={cx(styles.card)}>
        <Typography.Title level={1} className={cx(styles.title)}>
          <span aria-hidden="true">🎷🐋</span> Beluga
        </Typography.Title>
        <p className={cx(styles.subtitle)}>Sign in to manage your store.</p>

        {login.isError ? (
          <Alert
            className={cx(styles.alert)}
            type={rateLimited ? "warning" : "error"}
            showIcon
            title={login.error instanceof Error ? login.error.message : "Could not sign in."}
          />
        ) : null}

        <Form
          layout="vertical"
          requiredMark={false}
          disabled={login.isPending}
          onFinish={(values: { email: string; password: string }) => {
            login.mutate(values, { onSuccess: () => void navigate(destination, { replace: true }) });
          }}
        >
          <Form.Item
            name="email"
            label="Email"
            rules={[{ required: true, message: "Enter your email." }]}
          >
            <Input type="email" autoComplete="username" autoFocus size="large" />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: "Enter your password." }]}
          >
            <Input.Password autoComplete="current-password" size="large" />
          </Form.Item>

          <Button type="primary" htmlType="submit" size="large" block loading={login.isPending}>
            Sign in
          </Button>
        </Form>

        <p className={cx(styles.footer)}>
          Lost the password? It is stored as an argon2id hash and cannot be read back. Create a
          replacement account from the command line:
          <code className={cx(styles.code)}>
            ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=&apos;…&apos; npm run db:seed
          </code>
        </p>

        <p className={cx(styles.footer)}>
          <Link to="/">← Back to the storefront</Link>
        </p>
      </Card>
    </div>
  );
}
