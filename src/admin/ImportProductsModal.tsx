import { useState } from "react";
import { Alert, App, Button, Checkbox, Modal, Table, Tag, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import {
  useCommitImport,
  useValidateImport,
  type ImportIssue,
  type ImportPreview,
  type ImportPreviewProduct,
} from "./queries";
import { cx } from "@/lib/cx";
import styles from "./ImportProductsModal.module.css";

/**
 * Catalogue import: choose a file, read the preview, confirm.
 *
 * Two phases, and the split is the whole point. Validation writes nothing, so
 * the merchant sees every error in the file at once and can go and fix them
 * before anything touches a live catalogue — a partial import that
 * half-updated one is worse than no import at all.
 *
 * The file is re-sent on confirm rather than a handle from the preview, so
 * what gets written is what was just validated.
 */
export function ImportProductsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const validate = useValidateImport();
  const commit = useCommitImport();

  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);

  const reset = () => {
    setFileName("");
    setCsv("");
    setPreview(null);
    // Off every time. Skipping rows is a deliberate choice for one file, never
    // a setting that quietly persists into the next import.
    setSkipInvalid(false);
    validate.reset();
    commit.reset();
    onClose();
  };

  const read = async (file: File) => {
    const text = await file.text();

    setFileName(file.name);
    setCsv(text);
    setPreview(null);
    setSkipInvalid(false);

    validate.mutate(text, {
      onSuccess: setPreview,
      onError: (error: unknown) =>
        void message.error(error instanceof Error ? error.message : "Could not read that file."),
    });
  };

  const errors = preview?.errors ?? [];
  const blocked = errors.length > 0 && !skipInvalid;
  const willWrite = preview ? preview.creates + preview.updates : 0;

  return (
    <Modal
      title="Import products from a CSV"
      open={open}
      width={760}
      onCancel={reset}
      footer={[
        <Button key="cancel" onClick={reset}>
          Cancel
        </Button>,
        <Button
          key="import"
          type="primary"
          disabled={!preview || blocked || willWrite === 0}
          loading={commit.isPending}
          onClick={() =>
            commit.mutate(
              { csv, skipInvalid },
              {
                onSuccess: (result) => {
                  message.success(
                    `Imported ${result.created} new and ${result.updated} updated product${
                      result.created + result.updated === 1 ? "" : "s"
                    }.`,
                  );
                  reset();
                },
                onError: (error: unknown) =>
                  void message.error(
                    error instanceof Error ? error.message : "Could not import that file.",
                  ),
              },
            )
          }
        >
          {preview ? `Import ${willWrite} product${willWrite === 1 ? "" : "s"}` : "Import"}
        </Button>,
      ]}
    >
      <Upload.Dragger
        className={cx(styles.dragger)}
        accept=".csv,text/csv"
        // The drop zone's own text is decorative markup; without this the file
        // input reaches a screen reader as an unnamed control.
        aria-label="Choose a CSV file to import"
        showUploadList={false}
        disabled={validate.isPending || commit.isPending}
        // Read here rather than by antd: the request needs the session's CSRF
        // token, and the response is a preview rather than an upload result.
        beforeUpload={(file) => {
          void read(file);
          return Upload.LIST_IGNORE;
        }}
      >
        <p className={cx(styles.dragIcon)}>
          <InboxOutlined />
        </p>
        <p className={cx(styles.dragText)}>
          {fileName === "" ? "Drop a CSV here, or click to choose" : fileName}
        </p>
        <p className={cx(styles.dragHint)}>
          Products are matched by <code>slug</code> — an existing one is updated, a new one is
          created. Export the catalogue first to see the format.
        </p>
      </Upload.Dragger>

      {validate.isPending ? <p className={cx(styles.status)}>Checking the file…</p> : null}

      {preview ? (
        <>
          <Alert
            className={cx(styles.summary)}
            type={errors.length > 0 ? "warning" : "success"}
            showIcon
            title={
              `${preview.rows} row${preview.rows === 1 ? "" : "s"} read: ` +
              `${preview.creates} to create, ${preview.updates} to update` +
              (errors.length > 0 ? `, ${errors.length} problem${errors.length === 1 ? "" : "s"}.` : ".")
            }
            description={
              <>
                Nothing has been changed yet.{" "}
                {/* Invariant 7, said out loud: a merchant importing a live
                    catalogue needs to know this before they confirm. */}
                Imported products are never published to Stripe — publishing stays a per-product
                action on the product itself. Images are not changed by an import; attach those in
                the product editor.
              </>
            }
          />

          {errors.length > 0 ? (
            <>
              <h4 className={cx(styles.heading)}>
                Problems{preview.errorsOmitted > 0 ? ` (first ${errors.length})` : ""}
              </h4>

              <Table<ImportIssue>
                className={cx(styles.table)}
                dataSource={errors}
                rowKey={(issue) => `${issue.row}:${issue.column}:${issue.message}`}
                size="small"
                pagination={errors.length > 10 ? { pageSize: 10, size: "small" } : false}
                columns={[
                  { title: "Row", dataIndex: "row", width: 70 },
                  {
                    title: "Column",
                    dataIndex: "column",
                    width: 190,
                    render: (column: string) => <code className={cx(styles.column)}>{column}</code>,
                  },
                  { title: "Problem", dataIndex: "message" },
                ]}
              />

              {preview.errorsOmitted > 0 ? (
                <p className={cx(styles.status)}>
                  …and {preview.errorsOmitted} more not shown. Fix these first.
                </p>
              ) : null}

              <Checkbox
                className={cx(styles.skip)}
                checked={skipInvalid}
                onChange={(event) => setSkipInvalid(event.target.checked)}
              >
                Import the other products anyway, skipping the ones listed above
              </Checkbox>
            </>
          ) : null}

          <h4 className={cx(styles.heading)}>What will change</h4>

          <Table<ImportPreviewProduct>
            className={cx(styles.table)}
            dataSource={preview.products}
            rowKey="slug"
            size="small"
            pagination={preview.products.length > 10 ? { pageSize: 10, size: "small" } : false}
            columns={[
              { title: "Product", dataIndex: "name" },
              {
                title: "Slug",
                dataIndex: "slug",
                render: (slug: string) => <code className={cx(styles.column)}>{slug}</code>,
              },
              {
                title: "Prices",
                dataIndex: "variants",
                width: 80,
              },
              {
                title: "Action",
                key: "action",
                width: 110,
                render: (_value, product) =>
                  !product.valid ? (
                    <Tag color="red">Skipped</Tag>
                  ) : product.action === "create" ? (
                    <Tag color="green">Create</Tag>
                  ) : (
                    <Tag color="blue">Update</Tag>
                  ),
              },
            ]}
          />
        </>
      ) : null}
    </Modal>
  );
}
