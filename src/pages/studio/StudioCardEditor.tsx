import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { Alert, Button, Input, Radio, Slider } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { PRINT_SIZES, defaultCrop, type Crop, type Orientation, type PostcardDesign } from "@shared/postcards";
import { cropFromDrag, nudgeCrop, previewGeometry } from "@/lib/crop";
import { cx } from "@/lib/cx";
import { ProductImage } from "@/components/ui/ProductImage";
import { PostcardBackMock } from "@/components/postcard/PostcardBackMock";
import postcard from "@/components/postcard/Postcard.module.css";
import styles from "./Studio.module.css";

/**
 * One card of an edition: a picture for the front, a title for the back.
 *
 * Like a postcard from a museum shop, the back is a caption — the title of
 * the piece over the artist's name — and the mock beside the title field
 * shows it as it will print. The front is the artist's picture in the
 * card's frame: the crop the frame shows is the crop that prints, since the
 * preview and the server size the same window with the same three numbers
 * (`cropRect`), and dragging the picture, the arrow keys and the zoom slider
 * all move it.
 *
 * Nothing is posted from here. Save hands the picture, its crop and the
 * title to the edition page, which uploads and writes the card in one go.
 */

export interface CardInput {
  /** A new picture, or null to keep the saved one. */
  file: File | null;
  orientation: Orientation;
  crop: Crop;
  title: string;
}

interface StudioCardEditorProps {
  /** 1-based: the card's place in the set. */
  number: number;
  artistName: string;
  siteName: string;
  /** The saved card being changed, or null for a new one. */
  existing: { design: PostcardDesign; title: string | null } | null;
  pending: boolean;
  error: string | null;
  onSave: (input: CardInput) => void;
  onCancel: () => void;
}

interface Picked {
  file: File;
  url: string;
  width: number;
  height: number;
}

export function StudioCardEditor({ number, artistName, siteName, existing, pending, error, onSave, onCancel }: StudioCardEditorProps) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [orientation, setOrientation] = useState<Orientation>(existing?.design.orientation ?? "portrait");
  const [crop, setCrop] = useState<Crop>(defaultCrop);
  const [moved, setMoved] = useState(false);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState(existing?.title ?? "");
  const fileId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);

  // A saved picture keeps its orientation until a new one is chosen.
  const saved = existing && !picked ? existing.design : null;
  const previewOrientation = saved ? saved.orientation : orientation;
  const size = PRINT_SIZES[previewOrientation];
  const lowRes = picked !== null && (picked.width < size.width || picked.height < size.height);

  // Opened inline, under the shelf: focus lands on the heading so a keyboard
  // user arrives where the work is.
  useEffect(() => headingRef.current?.focus(), []);

  // Object URLs are revoked when the file changes or the editor closes.
  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.url);
  }, [picked]);

  // `--frame-ratio` is the same shape as `aspect-ratio`, as a number the
  // stylesheet can multiply a length by, so the frame's width follows the
  // orientation on a desktop and its height on a phone.
  const frameStyle = useMemo(
    () => ({ "--frame-ratio": size.width / size.height, aspectRatio: `${size.width} / ${size.height}` }) as CSSProperties,
    [size],
  );

  // The frame's rendered size: it follows the orientation and the viewport,
  // and the picture's geometry is computed from whatever it is right now.
  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [previewOrientation]);

  const geometry = picked && box ? previewGeometry(picked, box, crop) : null;

  const choose = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setPicked({ file, url, width: image.naturalWidth, height: image.naturalHeight });
      setCrop(defaultCrop);
      setMoved(false);
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  };

  const openPicker = () => document.getElementById(fileId)?.click();

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files?.[0]);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!picked) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const held = pointer.current;
    if (!held || held.id !== event.pointerId || !geometry) return;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    pointer.current = { ...held, x: event.clientX, y: event.clientY };
    if (dx === 0 && dy === 0) return;
    setCrop((current) => cropFromDrag(current, dx, dy, geometry));
    setMoved(true);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    // Empty, the frame is a button and `onPointerDown` never captured anything.
    if (!picked) return;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!picked) return;
    const next = nudgeCrop(crop, event.key);
    if (!next) return;
    event.preventDefault();
    setCrop(next);
    setMoved(true);
  };

  const ready = picked !== null || existing !== null;
  const submit = () => {
    if (!ready || pending) return;
    onSave({ file: picked?.file ?? null, orientation: previewOrientation, crop, title: title.trim() });
  };

  return (
    <section className={styles.panel} aria-labelledby="card-editor-heading">
      <h3 id="card-editor-heading" ref={headingRef} tabIndex={-1} className={styles.pickerHeading}>
        Card {number}
      </h3>

      <div className={postcard.editor}>
        <div className={postcard.side}>
          <p className={postcard.sideLabel}>Front</p>

          {/*
           * Empty, the frame is a button: every tester clicked it before they
           * found the upload button beside it. It is a `role="img"` once
           * there is something to look at — a saved picture or a fresh pick —
           * because that role would hide the button from a screen reader.
           */}
          <div
            ref={previewRef}
            className={postcard.frontPreview}
            style={frameStyle}
            role={ready ? "img" : undefined}
            aria-label={
              picked ? "Your picture in the card. Drag it, or use the arrow keys, to choose what shows." : saved ? "The saved picture for this card" : undefined
            }
            tabIndex={picked ? 0 : -1}
            data-photo={picked ? "" : undefined}
            data-dragging={dragging ? "" : undefined}
            onDragOver={onDragOver}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          >
            {picked ? (
              <img
                className={postcard.frontImage}
                src={picked.url}
                alt=""
                draggable={false}
                style={geometry ? { width: geometry.width, height: geometry.height, transform: `translate(${-geometry.left}px, ${-geometry.top}px)` } : undefined}
              />
            ) : saved ? (
              <ProductImage image={saved.thumbnail} className={postcard.frontSaved ?? ""} decorative />
            ) : (
              <button type="button" className={postcard.frontEmpty} onClick={openPicker}>
                <UploadOutlined aria-hidden />
                <span>Add a picture</span>
              </button>
            )}
            <div className={postcard.safeArea} aria-hidden />
            {picked && !moved ? (
              <span className={postcard.frontHint} aria-hidden>
                Drag to reposition
              </span>
            ) : null}
          </div>

          <div className={postcard.controls}>
            <label htmlFor={fileId} className={postcard.fileLabel}>
              <input id={fileId} className={postcard.fileInput} type="file" accept="image/*" onChange={(event) => choose(event.target.files?.[0])} />
              <Button icon={<UploadOutlined />} onClick={openPicker}>
                {ready ? "Choose a different picture" : "Choose a picture"}
              </Button>
            </label>
            {saved ? null : (
              <Radio.Group
                value={orientation}
                onChange={(event) => setOrientation(event.target.value as Orientation)}
                aria-label="Orientation"
                options={[
                  { label: "Portrait", value: "portrait" },
                  { label: "Landscape", value: "landscape" },
                ]}
              />
            )}
          </div>

          {picked ? (
            <div className={cx(styles.field, postcard.zoom)}>
              <span className={styles.label} id="zoom-label">
                Zoom
              </span>
              <Slider
                ariaLabelForHandle="Zoom"
                min={1}
                max={3}
                step={0.05}
                value={crop.zoom}
                tooltip={{ formatter: (value) => `${(value ?? 1).toFixed(2)}×` }}
                onChange={(value: number) => {
                  setCrop((current) => ({ ...current, zoom: value }));
                  setMoved(true);
                }}
              />
            </div>
          ) : null}

          {lowRes ? (
            <Alert type="warning" showIcon title={`At ${picked?.width} × ${picked?.height} pixels this picture will print a little soft.`} />
          ) : null}
        </div>

        <div className={postcard.side}>
          <p className={postcard.sideLabel}>Back</p>
          <PostcardBackMock title={title} artistName={artistName} siteName={siteName} />
          <div className={cx(styles.field, styles.titleField)}>
            <label className={styles.label} htmlFor="card-title">
              Title
            </label>
            <Input id="card-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} onPressEnter={submit} />
          </div>
        </div>
      </div>

      {error ? <Alert type="error" showIcon title={error} style={{ marginTop: "1rem" }} /> : null}

      <div className={styles.actions}>
        <Button type="primary" disabled={!ready} loading={pending} onClick={submit}>
          {existing ? `Save card ${number}` : `Add card ${number}`}
        </Button>
        <Button onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
