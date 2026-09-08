import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { App, Button, Empty, Input, Skeleton, Space, Table, Tag, Tooltip } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined } from "@ant-design/icons";
import { ApiError } from "@/lib/api";
import {
  useDeleteProduct,
  useProducts,
  useReorderProducts,
  type ProductSummary,
} from "./queries";
import { PageHeader } from "./RequireAdmin";
import { ImportProductsModal } from "./ImportProductsModal";
import { cx } from "@/lib/cx";
import styles from "./ProductsPage.module.css";

/**
 * The catalogue.
 *
 * Ordering is done with buttons rather than drag-and-drop. Display order is
 * real, persisted data — it is the order the storefront renders in — and a
 * control for editing it should be reachable by anyone, including someone on a
 * phone or driving the page from the keyboard. v1 used `react-drag-sortable`,
 * which is unmaintained, React 19-incompatible, and mouse-only.
 */
export function ProductsPage() {
  const { modal, message } = App.useApp();
  const products = useProducts();
  const reorder = useReorderProducts();
  const remove = useDeleteProduct();

  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    document.title = "Products · Beluga";
  }, []);

  const all = useMemo(() => products.data ?? [], [products.data]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) || product.slug.includes(needle),
    );
  }, [all, search]);

  /**
   * Move one product by one place in the full list.
   *
   * Deliberately computed against `all`, never the filtered view: reordering
   * a search result would otherwise reshuffle products the user cannot see.
   */
  const move = (id: string, direction: -1 | 1) => {
    const index = all.findIndex((product) => product.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= all.length) return;

    const ids = all.map((product) => product.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(target, 0, moved);

    reorder.mutate(ids, {
      onError: (error: unknown) =>
        void message.error(error instanceof Error ? error.message : "Could not reorder."),
    });
  };

  /**
   * Delete, after naming what is being deleted.
   *
   * v1's version ran `splice(findIndex(...), 1)` with no check, so when the
   * target was not found `findIndex` returned -1 and `splice(-1, 1)` removed
   * the *last* product instead — silent data loss, on a miss. The API refuses
   * an unknown id outright now, and this dialog states the name so a misclick
   * is visible before it happens.
   */
  const confirmDelete = (product: ProductSummary) => {
    modal.confirm({
      title: `Delete “${product.name}”?`,
      okText: "Delete",
      okButtonProps: { danger: true },
      content: (
        <>
          <p>
            Its images are deleted with it. Past orders keep their own copy of the name and price,
            so order history is unaffected.
          </p>
          {product.isLive ? (
            <p>
              It is live on the storefront now. Its Stripe product is archived rather than deleted,
              because past orders still reference its prices.
            </p>
          ) : null}
        </>
      ),
      onOk: () =>
        remove.mutateAsync(product.id).then(
          () => void message.success(`Deleted “${product.name}”.`),
          (error: unknown) => {
            message.error(error instanceof Error ? error.message : "Could not delete.");
            // Rethrown so antd keeps the dialog open on failure.
            throw error;
          },
        ),
    });
  };

  if (products.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;

  if (products.isError) {
    const status = products.error instanceof ApiError ? products.error.status : 0;
    return (
      <Empty
        description={
          status === 401 ? "Your session expired. Sign in again." : "Could not load products."
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Products"
        description="Drafts are editable but never appear on the storefront."
        actions={
          <>
            <Input.Search
              className={cx(styles.search)}
              placeholder="Search products"
              allowClear
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search products"
            />
            {/*
             * A plain link, not a fetch: the route is a cookie-authenticated
             * GET and verifyCsrf skips safe methods, so there is no token to
             * attach and no blob to build. Same reasoning as the order export.
             */}
            <a href="/api/admin/products.csv">
              <Button>Export CSV</Button>
            </a>
            <Button onClick={() => setImporting(true)}>Import CSV</Button>
            <Link to="/admin/products/new">
              <Button type="primary">New product</Button>
            </Link>
          </>
        }
      />

      <ImportProductsModal open={importing} onClose={() => setImporting(false)} />

      {all.length === 0 ? (
        <Empty description="No products yet">
          <Link to="/admin/products/new">
            <Button type="primary">Create the first one</Button>
          </Link>
        </Empty>
      ) : (
        <Table<ProductSummary>
          dataSource={visible}
          rowKey="id"
          pagination={false}
          scroll={{ x: "max-content" }}
          columns={[
            {
              title: "Name",
              dataIndex: "name",
              render: (name: string, product) => (
                <Link to={`/admin/products/${product.slug}`}>{name}</Link>
              ),
            },
            {
              title: "Slug",
              dataIndex: "slug",
              render: (slug: string) => <code className={cx(styles.slug)}>/product/{slug}</code>,
            },
            {
              title: "Status",
              dataIndex: "isLive",
              render: (isLive: boolean, product) =>
                !isLive ? (
                  <Tag>Draft</Tag>
                ) : product.needsPublish ? (
                  // Live and unsellable is worse than either state on its own:
                  // the storefront shows it, and checkout refuses the whole
                  // order the moment someone tries to buy it.
                  <Tooltip title="On the storefront, but not published to Stripe — checkout will refuse an order containing it.">
                    <Tag color="error">Live · not published</Tag>
                  </Tooltip>
                ) : (
                  <Tag color="green">Live</Tag>
                ),
            },
            {
              title: "Order",
              key: "order",
              render: (_value, product) => {
                const index = all.findIndex((item) => item.id === product.id);

                return (
                  <Space.Compact>
                    <Tooltip title="Move up">
                      <Button
                        icon={<ArrowUpOutlined />}
                        aria-label={`Move ${product.name} up`}
                        disabled={index <= 0 || Boolean(search) || reorder.isPending}
                        onClick={() => move(product.id, -1)}
                      />
                    </Tooltip>
                    <Tooltip title="Move down">
                      <Button
                        icon={<ArrowDownOutlined />}
                        aria-label={`Move ${product.name} down`}
                        disabled={
                          index === -1 || index >= all.length - 1 || Boolean(search) || reorder.isPending
                        }
                        onClick={() => move(product.id, 1)}
                      />
                    </Tooltip>
                  </Space.Compact>
                );
              },
            },
            {
              title: "",
              key: "actions",
              align: "right",
              render: (_value, product) => (
                <Button
                  icon={<DeleteOutlined />}
                  aria-label={`Delete ${product.name}`}
                  danger
                  type="text"
                  onClick={() => confirmDelete(product)}
                />
              ),
            },
          ]}
        />
      )}

      {search && visible.length === 0 ? (
        <p className={cx(styles.noMatches)}>Nothing matches “{search}”.</p>
      ) : null}
    </>
  );
}
