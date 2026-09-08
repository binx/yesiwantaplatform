import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button, Form, Input, Result } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useForgotPassword } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/**
 * Request a reset link.
 *
 * Always shows the same confirmation, whether or not the address has an
 * account — the API always answers 204, for the same reason.
 */
export function ForgotPasswordPage() {
  const forgot = useForgotPassword();

  useEffect(() => {
    document.title = "Forgot password · Your account";
  }, []);

  if (forgot.isSuccess) {
    return (
      <PageWrapper width="prose">
        <Result
          status="success"
          title={<h1>Check your email</h1>}
          subTitle="If that address has an account, we've sent a link to reset the password. It works once and expires in an hour."
          extra={
            <Link to="/account/login">
              <Button type="primary">Back to sign in</Button>
            </Link>
          }
        />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper width="prose">
      <h1>Forgot your password?</h1>
      <p>Enter the email on your account and we'll send you a link to choose a new password.</p>

      <Form
        layout="vertical"
        requiredMark={false}
        disabled={forgot.isPending}
        className={cx(styles.form)}
        onFinish={(values: { email: string }) => forgot.mutate(values)}
      >
        <Form.Item
          name="email"
          label="Email"
          rules={[{ required: true, message: "Enter your email." }]}
        >
          <Input type="email" autoComplete="username" autoFocus size="large" />
        </Form.Item>

        <Button type="primary" htmlType="submit" size="large" block loading={forgot.isPending}>
          Send reset link
        </Button>
      </Form>

      <p className={cx(styles.footer)}>
        <Link to="/account/login">Back to sign in</Link>
      </p>
    </PageWrapper>
  );
}
