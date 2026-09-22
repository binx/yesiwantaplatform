import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Form, Input } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ApiError } from "@/lib/api";
import { useCustomer, useCustomerLogin } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

interface LocationState {
  from?: string;
}

/**
 * Sign in.
 *
 * The API answers a wrong password and an unknown account identically, and
 * so does this page — see `docs/tasks/11-customer-accounts.md`'s enumeration
 * note, the same reasoning as the admin login.
 */
export function AccountLoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const customer = useCustomer();
  const login = useCustomerLogin();

  // Accepts any same-site path the caller offers — e.g. the cart page's
  // "sign in for faster checkout" link — and falls back to the account
  // overview otherwise.
  const from = (location.state as LocationState | null)?.from;
  const destination = from && from.startsWith("/") ? from : "/account";


  if (customer.data) return <Navigate to={destination} replace />;

  const rateLimited = login.error instanceof ApiError && login.error.status === 429;

  return (
    <PageWrapper width="prose">
      <h1>Sign in</h1>

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
        className={cx(styles.form)}
        onFinish={(values: { email: string; password: string }) => {
          login.mutate(values, {
            onSuccess: () => void navigate(destination, { replace: true }),
          });
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
        <Link to="/account/forgot-password">Forgot your password?</Link>
      </p>
      <p className={cx(styles.footer)}>
        New here? <Link to="/account/register" state={from ? { from } : undefined}>Create an account</Link>
      </p>
    </PageWrapper>
  );
}
