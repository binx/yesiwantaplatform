import { Link } from "react-router-dom";
import { Button, Card, Form, Input, Typography } from "antd";
import { useForgotPassword } from "@/lib/session";
import { cx } from "@/lib/cx";
import styles from "./LoginPage.module.css";

/**
 * Request a reset link for a forgotten admin password.
 *
 * Public, like /admin/accept-invite: the caller cannot sign in, that is the
 * reason to be here. Always shows the same confirmation whether or not the
 * address belongs to an administrator — the API always answers 204, for the
 * same reason the customer equivalent does.
 */
export function ForgotPasswordPage() {
  const forgot = useForgotPassword();


  return (
    <main className={cx(styles.page)}>
      <Card className={cx(styles.card)}>
        <Typography.Title level={1} className={cx(styles.title)}>
          <span aria-hidden="true">✉️</span> Postcards
        </Typography.Title>

        {forgot.isSuccess ? (
          <p className={cx(styles.subtitle)}>
            If that address belongs to an administrator, we&apos;ve sent a link to reset the
            password. It works once and expires in an hour.
          </p>
        ) : (
          <>
            <p className={cx(styles.subtitle)}>
              Enter the email on the account and we&apos;ll send a link to choose a new password.
            </p>

            <Form
              layout="vertical"
              requiredMark={false}
              disabled={forgot.isPending}
              onFinish={(values: { email: string }) => forgot.mutate(values)}
            >
              <Form.Item
                name="email"
                label="Email"
                rules={[{ required: true, message: "Enter your email." }]}
              >
                <Input type="email" autoComplete="username" autoFocus size="large" />
              </Form.Item>

              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={forgot.isPending}
              >
                Send reset link
              </Button>
            </Form>
          </>
        )}

        <p className={cx(styles.footer)}>
          If this platform has no email provider, the link is in the API&apos;s log.
        </p>

        <p className={cx(styles.footer)}>
          <Link to="/admin/login">Back to sign in</Link>
        </p>
      </Card>
    </main>
  );
}
