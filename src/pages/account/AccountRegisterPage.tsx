import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { Alert, Button, Form, Input, Result } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useCustomer, useRegister } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

interface RegisterValues {
  email: string;
  password: string;
  name?: string;
}

/**
 * Create an account.
 *
 * The confirmation shown here is identical whether or not the email already
 * had an account — the API's response carries nothing that would let this
 * page say otherwise. See the register route's comment for why.
 */
export function AccountRegisterPage() {
  const customer = useCustomer();
  const register = useRegister();

  useEffect(() => {
    document.title = "Create an account · Your account";
  }, []);

  if (customer.data) return <Navigate to="/account" replace />;

  if (register.isSuccess) {
    return (
      <PageWrapper width="prose">
        <Result
          status="success"
          title={<h1>Check your email</h1>}
          subTitle="We've sent a link to verify your email. Once you've clicked it, any orders you've placed with this address will show up in your account."
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
      <h1>Create an account</h1>

      {register.isError ? (
        <Alert
          className={cx(styles.alert)}
          type="error"
          showIcon
          title={register.error instanceof Error ? register.error.message : "Could not register."}
        />
      ) : null}

      <Form
        layout="vertical"
        requiredMark={false}
        disabled={register.isPending}
        className={cx(styles.form)}
        onFinish={(values: RegisterValues) => {
          register.mutate({ email: values.email, password: values.password, name: values.name ?? null });
        }}
      >
        <Form.Item name="name" label="Name (optional)">
          <Input autoComplete="name" size="large" />
        </Form.Item>

        <Form.Item
          name="email"
          label="Email"
          rules={[{ required: true, message: "Enter your email." }]}
        >
          <Input type="email" autoComplete="username" size="large" />
        </Form.Item>

        <Form.Item
          name="password"
          label="Password"
          rules={[{ required: true, min: 12, message: "Use at least 12 characters." }]}
        >
          <Input.Password autoComplete="new-password" size="large" />
        </Form.Item>

        <Button type="primary" htmlType="submit" size="large" block loading={register.isPending}>
          Create account
        </Button>
      </Form>

      <p className={cx(styles.footer)}>
        Already have an account? <Link to="/account/login">Sign in</Link>
      </p>
    </PageWrapper>
  );
}
