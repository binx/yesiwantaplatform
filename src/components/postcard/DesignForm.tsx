import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Alert, Button, ColorPicker, Input, Radio, Slider } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import {
  BACK_FONTS,
  PRINT_SIZES,
  defaultCrop,
  defaultPostcardBack,
  type Crop,
  type Orientation,
  type PostcardBack,
  type PostcardDesign,
} from "@shared/postcards";
import { ApiError } from "@/lib/api";
import { useSaveDesign, useUpdateDesignBack } from "@/lib/designs";
import { cropFromDrag, nudgeCrop, previewGeometry } from "@/lib/crop";
import { cx } from "@/lib/cx";
import { ProductImage } from "@/components/ui/ProductImage";
import { PostcardBackMock } from "./PostcardBackMock";
import styles from "./Postcard.module.css";

/**
 * Design one postcard: a photo for the front, a note for the back.
 *
 * The crop the preview shows is the crop that prints. The photo is drawn
 * here at the scale and offset `cropRect` gives for the preview's size, and
 * the server resizes and extracts the same window at print size — one
 * function, two callers. Dragging the photo, the arrow keys and the zoom
 * slider all change the same three numbers, which go up with the file. The
 * frame drawn inside the preview is the safe area, a quarter inch in from
 * the trimmed edge, which is where Lob says text and faces should stay.
 *
 * Nothing is posted until Save: the file goes up once, with the back, and
 * comes back as a design id the schedule and the cart carry from there.
 */
interface DesignFormProps {
  onSaved: (design: PostcardDesign) => void;
  /** Whether the back will carry the reply QR, so the preview shows its footprint. */
  replyLink?: boolean;
  /** The design being edited, if any — its photo is fixed, only the back changes. */
  editing?: PostcardDesign | null;
  onEdited?: (design: PostcardDesign) => void;
  onCancelEdit?: () => void;
}

interface Picked {
  file: File;
  url: string;
  width: number;
  height: number;
}

export function DesignForm({ onSaved, replyLink = true, editing = null, onEdited, onCancelEdit }: DesignFormProps) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [back, setBack] = useState<PostcardBack>(defaultPostcardBack);
  const [crop, setCrop] = useState<Crop>(defaultCrop);
  const [moved, setMoved] = useState(false);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [fits, setFits] = useState(true);
  const save = useSaveDesign();
  const update = useUpdateDesignBack();
  const fileId = useId();
  const hintId = useId();
  const previewRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);

  // Entering edit mode seeds the back from the saved design and drops any
  // unsaved photo pick — the frame it shows from here is the saved thumbnail.
  // (The object-URL cleanup effect below still revokes whatever `picked` was.)
  useEffect(() => {
    if (!editing) return;
    setBack(editing.back);
    setPicked(null);
    setCrop(defaultCrop);
    setMoved(false);
  }, [editing]);

  const previewOrientation = editing?.orientation ?? orientation;
  const size = PRINT_SIZES[previewOrientation];
  const lowRes = picked !== null && (picked.width < size.width || picked.height < size.height);

  // Object URLs are revoked when the file changes or the form unmounts.
  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.url);
  }, [picked]);

  const previewStyle = useMemo(
    () => ({ aspectRatio: `${size.width} / ${size.height}` }),
    [size],
  );

  // The preview's rendered size: it follows the orientation and the viewport,
  // and the photo's geometry is computed from whatever it is right now.
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
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setPicked(null);
    };
    image.src = url;
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

  const set = <K extends keyof PostcardBack>(key: K, value: PostcardBack[K]) =>
    setBack((current) => ({ ...current, [key]: value }));

  const submit = () => {
    if (editing) {
      update.mutate(
        { id: editing.id, back },
        {
          onSuccess: (design) => {
            onEdited?.(design);
            setBack(defaultPostcardBack);
            setSavedFlash(true);
            setTimeout(() => setSavedFlash(false), 4000);
          },
        },
      );
      return;
    }
    if (!picked) return;
    save.mutate(
      { file: picked.file, orientation, back, crop },
      {
        onSuccess: (design) => {
          onSaved(design);
          setPicked(null);
          setBack(defaultPostcardBack);
          setCrop(defaultCrop);
          setMoved(false);
          setSavedFlash(true);
          setTimeout(() => setSavedFlash(false), 4000);
        },
      },
    );
  };

  const cancelEdit = () => {
    setBack(defaultPostcardBack);
    onCancelEdit?.();
  };

  return (
    <div className={cx(styles.form)}>
      <div className={styles.frontRow}>
        <div
          ref={previewRef}
          className={cx(styles.frontPreview)}
          style={previewStyle}
          role="img"
          aria-label={
            editing
              ? "The saved photo for this design"
              : picked
                ? "Your photo in the card. Drag it, or use the arrow keys, to choose what shows."
                : "Your photo goes here"
          }
          aria-describedby={picked ? hintId : undefined}
          tabIndex={picked ? 0 : -1}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {editing ? (
            <ProductImage image={editing.thumbnail} className={styles.frontImage} decorative />
          ) : picked ? (
            <img
              className={styles.frontImage}
              src={picked.url}
              alt=""
              draggable={false}
              style={
                geometry
                  ? { width: geometry.width, height: geometry.height, transform: `translate(${-geometry.left}px, ${-geometry.top}px)` }
                  : undefined
              }
            />
          ) : (
            <div className={styles.frontEmpty}>Your photo goes here</div>
          )}
          <div className={styles.safeArea} aria-hidden />
          {picked && !moved ? (
            <span className={styles.frontHint} aria-hidden>
              Drag to reposition
            </span>
          ) : null}
        </div>

        <div className={styles.frontControls}>
          {editing ? (
            <p className={styles.note}>To change the photo, remove this design and save a new one.</p>
          ) : (
            <>
              <label htmlFor={fileId} className={styles.fileLabel}>
                <input
                  id={fileId}
                  className={styles.fileInput}
                  type="file"
                  accept="image/*"
                  onChange={(event) => choose(event.target.files?.[0])}
                />
                <Button icon={<UploadOutlined />} onClick={() => document.getElementById(fileId)?.click()}>
                  {picked ? "Choose a different photo" : "Upload a photo"}
                </Button>
              </label>

              <Radio.Group
                value={orientation}
                onChange={(event) => setOrientation(event.target.value as Orientation)}
                aria-label="Orientation"
                options={[
                  { label: "Portrait", value: "portrait" },
                  { label: "Landscape", value: "landscape" },
                ]}
              />

              <div className={styles.field}>
                <span className={styles.label} id="zoom-label">
                  Zoom
                </span>
                <Slider
                  ariaLabelForHandle="Zoom"
                  min={1}
                  max={3}
                  step={0.05}
                  disabled={!picked}
                  value={crop.zoom}
                  tooltip={{ formatter: (value) => `${(value ?? 1).toFixed(2)}×` }}
                  onChange={(value: number) => {
                    setCrop((current) => ({ ...current, zoom: value }));
                    setMoved(true);
                  }}
                />
              </div>

              <p className={styles.note} id={hintId}>
                For a sharp print, use a photo at least {size.width} × {size.height} pixels. Drag the
                photo, or use the arrow keys, to choose what shows. The inner frame is the safe zone —
                anything outside it may be trimmed.
              </p>

              {lowRes ? (
                <Alert
                  type="warning"
                  showIcon
                  title="This photo is on the small side"
                  description={`It is ${picked?.width} × ${picked?.height} pixels, so it will look a little soft when printed.`}
                />
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className={styles.backRow}>
        <div className={styles.backControls}>
          <label className={styles.field}>
            <span className={styles.label}>Note for the back</span>
            <Input.TextArea
              value={back.text}
              maxLength={600}
              autoSize={{ minRows: 4, maxRows: 8 }}
              onChange={(event) => set("text", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Closing line</span>
            <Input
              value={back.valediction}
              maxLength={80}
              placeholder="e.g. Love, Grandma"
              onChange={(event) => set("valediction", event.target.value)}
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label} id="font-label">
              Style
            </span>
            <Radio.Group
              aria-labelledby="font-label"
              value={back.fontName}
              onChange={(event) => set("fontName", event.target.value as string)}
              options={BACK_FONTS.map((font) => ({
                value: font.name,
                label: <span style={{ fontFamily: `"${font.name}"` }}>{font.label}</span>,
              }))}
            />
          </div>

          <div className={styles.inline}>
            <div className={cx(styles.field, styles.grow)}>
              <span className={styles.label} id="size-label">
                Size
              </span>
              <Slider
                ariaLabelForHandle="Text size"
                min={12}
                max={32}
                step={4}
                marks={{ 12: "12", 20: "20", 32: "32" }}
                value={back.fontSize}
                onChange={(value: number) => set("fontSize", value)}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Ink</span>
              <ColorPicker
                value={back.fontColor}
                disabledAlpha
                onChange={(color) => set("fontColor", color.toHexString())}
              />
            </div>
          </div>
        </div>

        <PostcardBackMock back={back} replyLink={replyLink} onFit={setFits} />
      </div>

      {!fits ? (
        <Alert
          type="warning"
          showIcon
          title="That's more than fits on the card"
          description="Shorten the note, or choose a smaller size. What you see on the card is what prints."
        />
      ) : null}

      {editing && update.isError ? (
        <Alert
          type="error"
          showIcon
          title="That design could not be saved"
          description={
            update.error instanceof ApiError && update.error.status === 409
              ? `${update.error.message} Remove it from the schedule and save a fresh copy to change the note.`
              : update.error instanceof Error
                ? update.error.message
                : "Try again."
          }
        />
      ) : null}

      {!editing && save.isError ? (
        <Alert
          type="error"
          showIcon
          title="That design could not be saved"
          description={save.error instanceof Error ? save.error.message : "Try again."}
        />
      ) : null}

      <div className={styles.actions}>
        <Button
          type="primary"
          size="large"
          disabled={(!editing && !picked) || !fits}
          loading={editing ? update.isPending : save.isPending}
          onClick={submit}
        >
          {editing ? "Save changes" : savedFlash ? "Saved!" : "Save this design"}
        </Button>
        {editing ? (
          <Button size="large" onClick={cancelEdit}>
            Cancel
          </Button>
        ) : null}
        <span className={styles.note} role="status">
          {!fits
            ? "Shorten the note, or choose a smaller size. What you see on the card is what prints."
            : savedFlash
              ? editing
                ? "Updated."
                : "Added to the schedule below. Save another, or scroll down to add recipients."
              : editing
                ? "Change the note, closing line, style, size or ink, then save."
                : "Save each design, then choose who gets it and when."}
        </span>
      </div>
    </div>
  );
}
