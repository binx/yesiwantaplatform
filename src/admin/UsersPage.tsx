import { useEffect, useState } from "react";
import { Alert, App, Button, Card, Input, Popconfirm, Select, Skeleton, Table, Tag } from "antd";
import type { AdminRole, AdminSummary } from "@shared/api";
import { cx } from "@/lib/cx";
import {
  useChangePassword,
  useEnvironment,
  useInviteStaff,
  useRemoveStaff,
  useRevokeInvite,
  useStaff,
  useStoreLocale,
} from "./queries";
import { Field } from "./Field";
import { PageHeader } from "./RequireAdmin";
import { formatOrderDate } from "./orderPresentation";
import styles from "./UsersPage.module.css";

/**
 * Who can get into the admin.
 *
 * Before this there was no way to add a second account and no way to revoke
 * one, so a two-person shop shared a password and a departure meant changing
 * it. Access is granted by single-use invitation and removed immediately —
 * removing someone signs them out rather than waiting for a cookie to expire.
 */
export function UsersPage() {
  const locale = useStoreLocale();
  const { message } = App.useApp();
  const staff = useStaff();
  const environment = useEnvironment();
  const invite = useInviteStaff();
  const remove = useRemoveStaff();
  const revoke = useRevokeInvite();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("staff");
  const [lastLink, setLastLink] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Staff · Beluga";
  }, []);

  if (staff.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <PageHeader
        title="Staff"
        description="Everyone who can sign in to this admin."
      />

      <div className={cx(styles.columns)}>
        <div>
          <Card title="Accounts" className={cx(styles.card)}>
            {/*
              Roles are recorded but do not gate anything yet, and saying so is
              better than letting someone assume "staff" is a restriction.
            */}
            <p className={cx(styles.help)}>
              Everyone here has full access, including billing and refunds. The role is a label
              for your own reference.
            </p>

            <Table<AdminSummary>
              dataSource={staff.data?.users ?? []}
              rowKey="id"
              pagination={false}
              size="middle"
              scroll={{ x: "max-content" }}
              columns={[
                {
                  title: "Email",
                  dataIndex: "email",
                  render: (value: string, user) => (
                    <>
                      {value} {user.isSelf ? <Tag>You</Tag> : null}
                    </>
                  ),
                },
                {
                  title: "Role",
                  dataIndex: "role",
                  render: (value: AdminRole) => (value === "owner" ? "Owner" : "Staff"),
                },
                {
                  title: "Last signed in",
                  dataIndex: "lastLoginAt",
                  render: (value: number | null) =>
                    value ? (
                      formatOrderDate(value, true, locale)
                    ) : (
                      <span className={cx(styles.muted)}>Never</span>
                    ),
                },
                {
                  title: "Actions",
                  key: "actions",
                  align: "right",
                  render: (_value, user) =>
                    user.isSelf ? null : (
                      <Popconfirm
                        title={`Remove ${user.email}?`}
                        description="They are signed out immediately and cannot sign back in."
                        okText="Remove"
                        okButtonProps={{ danger: true }}
                        onConfirm={() =>
                          remove.mutate(user.id, {
                            onSuccess: () => void message.success(`${user.email} removed.`),
                            onError: (error: unknown) =>
                              void message.error(
                                error instanceof Error ? error.message : "Could not remove them.",
                              ),
                          })
                        }
                      >
                        <Button danger size="small">
                          Remove
                        </Button>
                      </Popconfirm>
                    ),
                },
              ]}
            />
          </Card>

          {staff.data && staff.data.invites.length > 0 ? (
            <Card title="Pending invitations" className={cx(styles.card)}>
              <Table
                dataSource={staff.data.invites}
                rowKey="id"
                pagination={false}
                size="small"
                columns={[
                  { title: "Email", dataIndex: "email" },
                  {
                    title: "Actions",
                    key: "actions",
                    align: "right",
                    render: (_value, row: { id: string; email: string }) => (
                      <Button size="small" onClick={() => revoke.mutate(row.id)}>
                        Revoke
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}
        </div>

        <div>
          <Card title="Invite someone" className={cx(styles.card)}>
            <Field label="Email">
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  value={email}
                  placeholder="colleague@example.com"
                  onChange={(event) => setEmail(event.target.value)}
                />
              )}
            </Field>

            <Field label="Role">
              {(control) => (
                <Select<AdminRole>
                  {...control}
                  style={{ width: "100%" }}
                  value={role}
                  onChange={setRole}
                  options={[
                    { label: "Staff", value: "staff" },
                    { label: "Owner", value: "owner" },
                  ]}
                />
              )}
            </Field>

            <p className={cx(styles.help)}>
              {environment.data?.hasEmail
                ? "They get a link that works once and expires in 72 hours."
                : "No email provider is configured, so the link will be shown here for you to pass on."}
            </p>

            <Button
              type="primary"
              block
              disabled={!email.trim()}
              loading={invite.isPending}
              onClick={() =>
                invite.mutate(
                  { email: email.trim(), role },
                  {
                    onSuccess: (result) => {
                      setEmail("");
                      setLastLink(result.inviteUrl ?? null);
                      message.success(
                        result.inviteUrl
                          ? "Invitation created. Copy the link below."
                          : `Invitation sent to ${result.email}.`,
                      );
                    },
                    onError: (error: unknown) =>
                      void message.error(
                        error instanceof Error ? error.message : "Could not send the invitation.",
                      ),
                  },
                )
              }
            >
              Send invitation
            </Button>

            {lastLink ? (
              <Alert
                style={{ marginTop: 16 }}
                type="info"
                showIcon
                title="Send them this link"
                description={
                  <>
                    <span>It works once and expires in 72 hours. Treat it like a password.</span>
                    <code className={cx(styles.link)}>{lastLink}</code>
                  </>
                }
              />
            ) : null}
          </Card>

          <ChangePasswordCard />
        </div>
      </div>
    </>
  );
}

function ChangePasswordCard() {
  const { message } = App.useApp();
  const change = useChangePassword();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  const tooShort = next.length > 0 && next.length < 12;

  return (
    <Card title="Your password" className={cx(styles.card)}>
      <Field label="Current password">
        {(control) => (
          <Input.Password
            {...control}
            value={current}
            autoComplete="current-password"
            onChange={(event) => setCurrent(event.target.value)}
          />
        )}
      </Field>

      <Field
        label="New password"
        {...(tooShort ? { error: "Use at least 12 characters." } : { help: "At least 12 characters." })}
      >
        {(control) => (
          <Input.Password
            {...control}
            value={next}
            autoComplete="new-password"
            onChange={(event) => setNext(event.target.value)}
          />
        )}
      </Field>

      <Button
        block
        disabled={!current || next.length < 12}
        loading={change.isPending}
        onClick={() =>
          change.mutate(
            { current, next },
            {
              onSuccess: () => {
                setCurrent("");
                setNext("");
                message.success("Password changed.");
              },
              onError: (error: unknown) =>
                void message.error(
                  error instanceof Error ? error.message : "Could not change your password.",
                ),
            },
          )
        }
      >
        Change password
      </Button>
    </Card>
  );
}
