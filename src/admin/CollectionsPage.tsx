import { useEffect, useState } from "react";
import { App, Button, Card, Empty, Input, Modal, Select, Skeleton, Space, Tooltip } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { FEATURED_SLUG, type Collection } from "@shared/schema";
import { cx } from "@/lib/cx";
import {
  useCollections,
  useCreateCollection,
  useDeleteCollection,
  useProducts,
  useReorderCollections,
  useUpdateCollection,
} from "./queries";
import { Field } from "./Field";
import { PageHeader } from "./RequireAdmin";
import styles from "./CollectionsPage.module.css";

/**
 * Collections.
 *
 * The featured row on the landing page is a collection at a reserved slug
 * rather than a separate concept, so there is one thing to learn instead of
 * two. Deleting one never touches the products in it.
 */
export function CollectionsPage() {
  const { modal, message } = App.useApp();

  const collections = useCollections();
  const products = useProducts();
  const create = useCreateCollection();
  const update = useUpdateCollection();
  const remove = useDeleteCollection();
  const reorder = useReorderCollections();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    document.title = "Collections · Beluga";
  }, []);

  const all = collections.data ?? [];

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= all.length) return;

    const ids = all.map((collection) => collection.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(target, 0, moved);

    reorder.mutate(ids, {
      onError: (error: unknown) =>
        void message.error(error instanceof Error ? error.message : "Could not reorder."),
    });
  };

  /**
   * v1's delete ran `splice(findIndex(...), 1)` unguarded, so a miss deleted
   * the last collection instead of the intended one. The API refuses an
   * unknown id; this dialog names what is going.
   */
  const confirmDelete = (collection: Collection) => {
    modal.confirm({
      title: `Delete “${collection.name}”?`,
      okText: "Delete",
      okButtonProps: { danger: true },
      content: `The ${collection.productIds.length} product${
        collection.productIds.length === 1 ? "" : "s"
      } in it are not deleted — they just stop appearing here.`,
      onOk: () =>
        remove.mutateAsync(collection.id).then(
          () => void message.success(`Deleted “${collection.name}”.`),
          (error: unknown) => {
            message.error(error instanceof Error ? error.message : "Could not delete.");
            throw error;
          },
        ),
    });
  };

  const setProducts = (collection: Collection, productIds: string[]) => {
    update.mutate(
      { id: collection.id, input: { slug: collection.slug, name: collection.name, productIds } },
      {
        onError: (error: unknown) =>
          void message.error(error instanceof Error ? error.message : "Could not save."),
      },
    );
  };

  const rename = (collection: Collection, name: string) => {
    if (name.trim() === "" || name === collection.name) return;

    update.mutate(
      {
        id: collection.id,
        input: { slug: collection.slug, name, productIds: collection.productIds },
      },
      {
        onError: (error: unknown) =>
          void message.error(error instanceof Error ? error.message : "Could not rename."),
      },
    );
  };

  if (collections.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;

  const productOptions = (products.data ?? []).map((product) => ({
    label: product.isLive ? product.name : `${product.name} (draft)`,
    value: product.id,
  }));

  return (
    <>
      <PageHeader
        title="Collections"
        description="Groups of products, each with its own page. Products can be in several."
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            New collection
          </Button>
        }
      />

      {all.length === 0 ? (
        <Empty description="No collections yet">
          <Button type="primary" onClick={() => setCreating(true)}>
            Create one
          </Button>
        </Empty>
      ) : (
        <div className={cx(styles.list)}>
          {all.map((collection, index) => (
            <Card
              key={collection.id}
              className={cx(styles.card)}
              title={
                <Input
                  className={cx(styles.name)}
                  defaultValue={collection.name}
                  aria-label={`Name of ${collection.name}`}
                  variant="borderless"
                  onBlur={(event) => rename(collection, event.target.value)}
                  onPressEnter={(event) => event.currentTarget.blur()}
                />
              }
              extra={
                <Space>
                  <Space.Compact>
                    <Tooltip title="Move up">
                      <Button
                        icon={<ArrowUpOutlined />}
                        aria-label={`Move ${collection.name} up`}
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => move(index, -1)}
                      />
                    </Tooltip>
                    <Tooltip title="Move down">
                      <Button
                        icon={<ArrowDownOutlined />}
                        aria-label={`Move ${collection.name} down`}
                        disabled={index === all.length - 1 || reorder.isPending}
                        onClick={() => move(index, 1)}
                      />
                    </Tooltip>
                  </Space.Compact>
                  <Button
                    icon={<DeleteOutlined />}
                    aria-label={`Delete ${collection.name}`}
                    danger
                    type="text"
                    onClick={() => confirmDelete(collection)}
                  />
                </Space>
              }
            >
              <p className={cx(styles.meta)}>
                <code>/collection/{collection.slug}</code>
                {collection.slug === FEATURED_SLUG ? (
                  <span className={cx(styles.badge)}>Shown on the landing page</span>
                ) : null}
              </p>

              <Field label="Products, in the order they appear">
                {(control) => (
                  <Select
                    {...control}
                    mode="multiple"
                    className={cx(styles.select)}
                    value={collection.productIds}
                    options={productOptions}
                    placeholder="Choose products"
                    optionFilterProp="label"
                    onChange={(ids: string[]) => setProducts(collection, ids)}
                  />
                )}
              </Field>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title="New collection"
        open={creating}
        okText="Create"
        confirmLoading={create.isPending}
        onCancel={() => {
          setCreating(false);
          setNewName("");
        }}
        onOk={() => {
          const name = newName.trim();
          if (name === "") return;

          create.mutate(
            { slug: slugify(name), name, productIds: [] },
            {
              onSuccess: () => {
                setCreating(false);
                setNewName("");
              },
              onError: (error: unknown) =>
                void message.error(error instanceof Error ? error.message : "Could not create it."),
            },
          );
        }}
      >
        <Field
          label="Name"
          help={
            <>
              Its address is derived from this: <code>/collection/{slugify(newName) || "…"}</code>
            </>
          }
        >
          {(control) => (
            <Input
              {...control}
              value={newName}
              autoFocus
              placeholder="Summer"
              onChange={(event) => setNewName(event.target.value)}
              onPressEnter={(event) => event.currentTarget.blur()}
            />
          )}
        </Field>
      </Modal>
    </>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
