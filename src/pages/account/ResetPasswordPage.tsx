import { Link, useSearchParams } from "react-router-dom";
import { Alert, Button, Form, Input, Result } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useResetPassword } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/**
 * Choose a new password from a reset link.
 *
 * Public: signing in with the old password is exactly what this page exists
 * to let someone skip. The token is spent server-side on submit and cannot
 * be reused — see `consumePasswordResetToken`.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const reset = useResetPassword();


  if (!token) {
    return (
      <PageWrapper width="prose">
        <Result
          status="warning"
          title={<h1>No reset link</h1>}
          subTitle="This page is opened from the link in your password-reset email."
          extra={
            <Link to="/account/forgot-password">
              <Button type="primary">Request a new link</Button>
            </Link>
          }
        />
      </PageWrapper>
    );
  }

  if (reset.isSuccess) {
    return (
      <PageWrapper width="prose">
        <Result
          status="success"
          title={<h1>Password changed</h1>}
          subTitle="Sign in with your new password."
          extra={
            <Link to="/account/login">
              <Button type="primary">Sign in</Button>
            </Link>
          }
        />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper width="prose">
      <h1>Choose a new password</h1>

      {reset.isError ? (
        <Alert
          className={cx(styles.alert)}
          type="error"
          showIcon
          title={
            reset.error instanceof Error ? reset.error.message : "That reset link could not be used."
          }
        />
      ) : null}

      <Form
        layout="vertical"
        requiredMark={false}
        disabled={reset.isPending}
        className={cx(styles.form)}
        onFinish={(values: { password: string }) => {
          reset.mutate({ token, password: values.password });
        }}
      >
        <Form.Item
          name="password"
          label="New password"
          rules={[{ required: true, min: 12, message: "Use at least 12 characters." }]}
        >
          <Input.Password autoComplete="new-password" autoFocus size="large" />
        </Form.Item>

        <Button type="primary" htmlType="submit" size="large" block loading={reset.isPending}>
          Change password
        </Button>
      </Form>
    </PageWrapper>
  );
}
