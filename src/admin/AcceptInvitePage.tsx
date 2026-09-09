import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { csrfPost } from "@/lib/api";
import { sessionQueryKey } from "@/lib/session";
import { cx } from "@/lib/cx";
import styles from "./LoginPage.module.css";

/**
 * Accept an invitation to help run the store.
 *
 * Public: the invitee has no account yet, so this cannot sit behind the admin
 * session check. The token arrives in the URL and is spent here — the server
 * looks it up by hash, so a tampered link simply matches nothing.
 */
export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");

  const accept = useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      csrfPost<{ isAdmin: boolean }>("/invites/accept", input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      void navigate("/admin", { replace: true });
    },
  });

  useEffect(() => {
    document.title = "Accept invitation · Beluga";
  }, []);

  if (!token) return <Navigate to="/admin/login" replace />;

  const tooShort = password.length > 0 && password.length < 12;

  return (
    <main className={cx(styles.page)}>
      <Card className={cx(styles.card)}>
        <Typography.Title level={1} className={cx(styles.title)}>
          <span aria-hidden="true">🎷🐋</span> Beluga
        </Typography.Title>
        <p className={cx(styles.subtitle)}>Choose a password to finish setting up your account.</p>

        {accept.isError ? (
          <Alert
            className={cx(styles.alert)}
            type="error"
            showIcon
            title={
              accept.error instanceof Error
                ? accept.error.message
                : "That invitation could not be used."
            }
          />
        ) : null}

        <Form layout="vertical" onFinish={() => void accept.mutate({ token, password })}>
          {/*
            The id and htmlFor are load-bearing, not decoration.

            antd derives a label's `for` from the Form.Item's `name`, and this
            field has none — it is controlled React state rather than an entry
            in antd's form store, because the button's disabled state reads the
            length as it is typed. So the label rendered, looked correct, and
            was attached to nothing: an invited colleague on a screen reader
            got "edit text, blank" for the one field on the page.
          */}
          <Form.Item
            label="Password"
            htmlFor="invite-password"
            {...(tooShort ? ({ validateStatus: "error" } as const) : {})}
            help={tooShort ? "Use at least 12 characters." : "At least 12 characters."}
          >
            <Input.Password
              id="invite-password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            block
            disabled={password.length < 12}
            loading={accept.isPending}
          >
            Create my account
          </Button>
        </Form>
      </Card>
    </main>
  );
}
