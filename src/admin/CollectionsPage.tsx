import { useEffect, useState } from "react";
import { App, Button, Card, Empty, Input, Modal, Select, Skeleton, Space, Tooltip, Upload } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { FEATURED_SLUG, type CollectionDraft } from "@shared/schema";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import {
  useCollections,
  useCreateCollection,
  useDeleteCollection,
  useProducts,
  useReorderCollections,
  useUpdateCollection,
  useUploadCollectionCover,
} from "./queries";
import { Field, type ControlProps } from "./Field";
import { MarkdownEditor } from "./MarkdownEditor";
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
  const uploadCover = useUploadCollectionCover();

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
  const confirmDelete = (collection: CollectionDraft) => {
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

  /**
   * Every save sends the whole collection.
   *
   * The three callers below each used to build their own payload from the
   * fields they cared about, which is how `cover` came to be silently dropped
   * on every rename and every product change — a merchant could not have set
   * one anyway, but the shape was already wrong. One place to add a field to
   * now, and `CollectionInput` makes leaving one out a type error.
   */
  const save = (
    collection: CollectionDraft,
    patch: Partial<Pick<CollectionDraft, "name" | "cover" | "description" | "productIds">>,
    failure: string,
  ) => {
    update.mutate(
      {
        id: collection.id,
        input: {
          slug: collection.slug,
          name: patch.name ?? collection.name,
          cover: patch.cover !== undefined ? patch.cover : collection.cover,
          description:
            patch.description !== undefined ? patch.description : collection.description,
          productIds: patch.productIds ?? collection.productIds,
        },
      },
      {
        onError: (error: unknown) =>
          void message.error(error instanceof Error ? error.message : failure),
      },
    );
  };

  const rename = (collection: CollectionDraft, name: string) => {
    if (name.trim() === "" || name === collection.name) return;
    save(collection, { name }, "Could not rename.");
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

              <Field
                label="Cover image"
                help="Shown on /shop at 16:9. Without one the tile renders a placeholder."
              >
                {() => (
                  <div className={cx(styles.cover)}>
                    {collection.cover ? (
                      <img
                        className={cx(styles.coverImage)}
                        src={assetUrl(collection.cover.path)}
                        alt={collection.cover.alt}
                        width={collection.cover.width}
                        height={collection.cover.height}
                      />
                    ) : null}

                    <Space>
                      <Upload
                        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
                        showUploadList={false}
                        // Uploaded here rather than by antd, so the request
                        // carries the session's CSRF token — and so the row is
                        // only saved once the file is really on disk.
                        beforeUpload={(file) => {
                          uploadCover.mutate(
                            { id: collection.id, file, alt: `${collection.name} collection` },
                            {
                              onSuccess: (cover) =>
                                save(collection, { cover }, "Could not save the cover."),
                              onError: (error: unknown) =>
                                void message.error(
                                  error instanceof Error
                                    ? error.message
                                    : "That image could not be uploaded.",
                                ),
                            },
                          );
                          return Upload.LIST_IGNORE;
                        }}
                      >
                        <Button
                          icon={<UploadOutlined />}
                          loading={uploadCover.isPending}
                          aria-label={`${collection.cover ? "Replace" : "Upload"} the cover for ${collection.name}`}
                        >
                          {collection.cover ? "Replace" : "Upload"}
                        </Button>
                      </Upload>

                      {collection.cover ? (
                        <Button
                          type="link"
                          size="small"
                          onClick={() =>
                            save(collection, { cover: null }, "Could not remove the cover.")
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </Space>
                  </div>
                )}
              </Field>

              {/*
                * Saved on blur, not on every keystroke: `save` is a mutation
                * per call, and a debounce here would be a second autosave
                * implementation living next to the one the product editor
                * already has.
                */}
              <Field
                label="Introduction"
                help="Markdown, shown under the heading on the collection page. Optional."
              >
                {(control) => (
                  <CollectionDescription
                    control={control}
                    collection={collection}
                    onSave={(description) =>
                      save(collection, { description }, "Could not save the introduction.")
                    }
                  />
                )}
              </Field>

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
                    onChange={(ids: string[]) => save(collection, { productIds: ids }, "Could not save.")}
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
            { slug: slugify(name), name, cover: null, description: null, productIds: [] },
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

/**
 * The description editor for one collection card.
 *
 * Local state, saved on blur. Everything else on these cards saves
 * immediately — a name, a cover, a product list are each one gesture — but a
 * paragraph is typed, and a mutation per keystroke would be both a flood of
 * requests and a cursor that jumps every time the refetched list re-renders.
 * Blur is the moment the merchant has finished the thought.
 */
function CollectionDescription({
  collection,
  onSave,
  control,
}: {
  collection: CollectionDraft;
  onSave: (description: string | null) => void;
  control: ControlProps;
}) {
  const saved = collection.description ?? "";
  const [text, setText] = useState(saved);

  // A save elsewhere on the card refetches the list; adopt the server's copy
  // rather than holding a stale draft over it.
  useEffect(() => setText(saved), [saved]);

  return (
    <div
      onBlur={() => {
        if (text === saved) return;
        onSave(text.trim() === "" ? null : text);
      }}
    >
      <MarkdownEditor
        control={control}
        value={text}
        onChange={setText}
        minRows={4}
        placeholder="Things for the table and the shelf, made in small runs."
      />
    </div>
  );
}
