import { useState } from "react";
import { App, Alert, Button, Input, Space, Tooltip, Upload } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import type { Image } from "@shared/schema";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import { useDeleteImage, useReorderImages, useUpdateImageAlt, useUploadImage } from "./queries";
import styles from "./ImageManager.module.css";

/**
 * Product imagery.
 *
 * Alt text is a first-class field here rather than an afterthought, because
 * the storefront now renders real `<img>` elements: in v1 every product image
 * was a `background-image` div, so the entire catalogue was invisible to
 * screen readers and to search engines and there was nowhere to put alt text
 * even if you wanted to.
 *
 * Uploads go straight to the server — filenames are generated there, the file
 * is validated by magic bytes and re-encoded, and the original name is
 * discarded. v1 wrote `file.originalname` into a path built from an
 * unsanitised route parameter, and "sanitised" it in the browser.
 */

interface ImageManagerProps {
  productId: string | null;
  images: Image[];
  onChange: (images: Image[]) => void;
}

export function ImageManager({ productId, images, onChange }: ImageManagerProps) {
  const { message } = App.useApp();
  const upload = useUploadImage();
  const remove = useDeleteImage();
  const reorder = useReorderImages();
  const updateAlt = useUpdateImageAlt();

  // Alt text is committed on blur, so typing does not fire a request per key.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (!productId) {
    return (
      <Alert
        type="info"
        showIcon
        title="Images can be added once the product is saved"
        description="Give it a name and a price — the draft saves itself, and this panel opens."
      />
    );
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;

    const next = [...images];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);

    onChange(next);
    reorder.mutate(
      { productId, paths: next.map((image) => image.path) },
      {
        onError: (error: unknown) => {
          message.error(error instanceof Error ? error.message : "Could not reorder.");
          onChange(images);
        },
      },
    );
  };

  const commitAlt = (image: Image) => {
    const alt = drafts[image.path];
    if (alt === undefined || alt === image.alt) return;

    onChange(images.map((item) => (item.path === image.path ? { ...item, alt } : item)));

    updateAlt.mutate(
      { productId, path: image.path, alt },
      {
        onError: (error: unknown) =>
          void message.error(error instanceof Error ? error.message : "Could not save the alt text."),
      },
    );
  };

  return (
    <div>
      <Upload.Dragger
        className={cx(styles.dragger)}
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        showUploadList={false}
        disabled={upload.isPending}
        // Uploading is done here, not by antd, so the request carries the
        // session's CSRF token and the response updates local state directly.
        beforeUpload={(file) => {
          upload.mutate(
            { productId, file, alt: "" },
            {
              onSuccess: (image) => onChange([...images, image]),
              onError: (error: unknown) =>
                void message.error(
                  error instanceof Error ? error.message : `Could not upload ${file.name}.`,
                ),
            },
          );
          return Upload.LIST_IGNORE;
        }}
      >
        <p className={cx(styles.dragIcon)}>
          <InboxOutlined />
        </p>
        <p className={cx(styles.dragText)}>Drop images here, or click to choose</p>
        <p className={cx(styles.dragHint)}>
          JPEG, PNG, WebP, AVIF or GIF. They are re-encoded to WebP on upload.
        </p>
      </Upload.Dragger>

      {images.length === 0 ? (
        <p className={cx(styles.empty)}>No images yet. The first one is used as the thumbnail.</p>
      ) : (
        <ul className={cx(styles.list)}>
          {images.map((image, index) => (
            <li key={image.path} className={cx(styles.item)}>
              <img
                className={cx(styles.thumb)}
                src={assetUrl(image.path)}
                alt=""
                width={image.width}
                height={image.height}
                loading="lazy"
              />

              <div className={cx(styles.fields)}>
                <label className={cx(styles.altLabel)} htmlFor={`alt-${image.path}`}>
                  Alt text
                  {index === 0 ? <span className={cx(styles.badge)}>Thumbnail</span> : null}
                </label>
                <Input
                  id={`alt-${image.path}`}
                  value={drafts[image.path] ?? image.alt}
                  placeholder="Describe the image for someone who cannot see it"
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [image.path]: event.target.value }))
                  }
                  onBlur={() => commitAlt(image)}
                  onPressEnter={(event) => event.currentTarget.blur()}
                />
                <p className={cx(styles.meta)}>
                  {image.width} × {image.height}
                </p>
              </div>

              <Space.Compact className={cx(styles.controls)}>
                <Tooltip title="Move earlier">
                  <Button
                    icon={<ArrowUpOutlined />}
                    aria-label={`Move image ${index + 1} earlier`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  />
                </Tooltip>
                <Tooltip title="Move later">
                  <Button
                    icon={<ArrowDownOutlined />}
                    aria-label={`Move image ${index + 1} later`}
                    disabled={index === images.length - 1}
                    onClick={() => move(index, 1)}
                  />
                </Tooltip>
                <Tooltip title="Remove">
                  <Button
                    icon={<DeleteOutlined />}
                    aria-label={`Remove image ${index + 1}`}
                    danger
                    onClick={() =>
                      remove.mutate(
                        { productId, path: image.path },
                        {
                          onSuccess: () =>
                            onChange(images.filter((item) => item.path !== image.path)),
                          onError: (error: unknown) =>
                            void message.error(
                              error instanceof Error ? error.message : "Could not remove it.",
                            ),
                        },
                      )
                    }
                  />
                </Tooltip>
              </Space.Compact>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
