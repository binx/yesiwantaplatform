import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Form, Input, Tag } from "antd";
import { useCustomer, useCustomerLogout, useUpdateProfile } from "@/lib/account";
import { useGallery } from "@/lib/gallery";
import { DesignCard } from "./AccountPostcardsPage";
import gallery from "./Gallery.module.css";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

export function AccountOverviewPage() {
  const customer = useCustomer();
  const update = useUpdateProfile();
  const logout = useCustomerLogout();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const recent = useGallery(3);
  const recentDesigns = recent.data?.pages[0]?.designs ?? [];

  useEffect(() => {
    document.title = "Account overview · Your account";
  }, []);

  if (!customer.data) return null;
  const profile = customer.data;

  return (
    <div>
      <div className={cx(styles.card)}>
        <div className={cx(styles.cardHeader)}>
          <div>
            <p>
              <strong>{profile.name ?? "No name set"}</strong>
            </p>
            <p className={cx(styles.meta)}>
              {profile.email}{" "}
              {profile.emailVerified ? (
                <Tag color="green">Verified</Tag>
              ) : (
                <Tag color="gold">Not verified</Tag>
              )}
            </p>
          </div>
          <div className={cx(styles.cardActions)}>
            <Button onClick={() => setEditing((v) => !v)}>{editing ? "Cancel" : "Edit name"}</Button>
          </div>
        </div>

        {editing ? (
          <Form
            layout="vertical"
            requiredMark={false}
            className={cx(styles.form)}
            disabled={update.isPending}
            initialValues={{ name: profile.name ?? "" }}
            onFinish={(values: { name: string }) => {
              update.mutate(
                { name: values.name.trim() === "" ? null : values.name },
                { onSuccess: () => setEditing(false) },
              );
            }}
          >
            {update.isError ? (
              <Alert
                className={cx(styles.alert)}
                type="error"
                showIcon
                title={update.error instanceof Error ? update.error.message : "Could not save."}
              />
            ) : null}
            <Form.Item name="name" label="Name">
              <Input autoComplete="name" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={update.isPending}>
              Save
            </Button>
          </Form>
        ) : null}

        {!profile.emailVerified ? (
          <Alert
            className={cx(styles.alert)}
            type="warning"
            showIcon
            title="Verify your email to see orders placed before you had an account."
          />
        ) : null}
      </div>

      {recentDesigns.length > 0 ? (
        <section className={cx(gallery.recent)} aria-labelledby="recent-heading">
          <h2 id="recent-heading">Your latest postcards</h2>
          <ul className={gallery.grid} aria-label="Latest postcards">
            {recentDesigns.map((design) => (
              <li key={design.id} className={gallery.card}>
                <DesignCard design={design} />
              </li>
            ))}
          </ul>
          <Link to="/account/postcards">All your postcards</Link>
        </section>
      ) : null}

      <Button
        loading={logout.isPending}
        onClick={() => logout.mutate(undefined, { onSuccess: () => void navigate("/") })}
      >
        Sign out
      </Button>
    </div>
  );
}
