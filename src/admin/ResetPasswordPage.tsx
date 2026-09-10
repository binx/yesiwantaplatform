import { useEffect } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useResetPassword } from "@/lib/session";
import { cx } from "@/lib/cx";
import styles from "./LoginPage.module.css";

/**
 * Choose a new password from an emailed reset link.
 *
 * Public: signing in with the old password is exactly what this page exists
 * to let someone skip. The token is spent server-side on submit and cannot be
 * reused — see `consumeAdminPasswordResetToken` — and the reset destroys
 * every session the account had, including whoever is still signed in with
 * the old password.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const reset = useResetPassword();

  useEffect(() => {
    document.title = "Reset password · Admin";
  }, []);

  if (!token) return <Navigate to="/admin/forgot-password" replace />;

  return (
    <main className={cx(styles.page)}>
      <Card className={cx(styles.card)}>
        <Typography.Title level={1} className={cx(styles.title)}>
          <span aria-hidden="true">✉️</span> Postcards
        </Typography.Title>

        {reset.isSuccess ? (
          <>
            <p className={cx(styles.subtitle)}>
              Your password has been changed. Every other session was signed out.
            </p>
            <Link to="/admin/login">
              <Button type="primary" size="large" block>
                Sign in
              </Button>
            </Link>
          </>
        ) : (
          <>
            <p className={cx(styles.subtitle)}>Choose a new password.</p>

            {reset.isError ? (
              <Alert
                className={cx(styles.alert)}
                type="error"
                showIcon
                title={
                  reset.error instanceof Error
                    ? reset.error.message
                    : "That reset link could not be used."
                }
              />
            ) : null}

            <Form
              layout="vertical"
              requiredMark={false}
              disabled={reset.isPending}
              onFinish={(values: { password: string }) =>
                reset.mutate({ token, password: values.password })
              }
            >
              <Form.Item
                name="password"
                label="New password"
                rules={[{ required: true, min: 12, message: "Use at least 12 characters." }]}
              >
                <Input.Password autoComplete="new-password" autoFocus size="large" />
              </Form.Item>

              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={reset.isPending}
              >
                Change password
              </Button>
            </Form>
          </>
        )}
      </Card>
    </main>
  );
}
