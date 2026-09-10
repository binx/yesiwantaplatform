import { useEffect, useId, useMemo, useState } from "react";
import { Alert, Button, ColorPicker, Input, Radio, Slider } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import {
  BACK_FONTS,
  PRINT_SIZES,
  defaultPostcardBack,
  type Orientation,
  type PostcardBack,
  type PostcardDesign,
} from "@shared/postcards";
import { useSaveDesign } from "@/lib/designs";
import { cx } from "@/lib/cx";
import { PostcardBackMock } from "./PostcardBackMock";
import styles from "./Postcard.module.css";

/**
 * Design one postcard: a photo for the front, a note for the back.
 *
 * The crop the preview shows is the crop that prints — `object-fit: cover`
 * here and sharp's `fit: cover` on the server are the same centre crop — and
 * the frame drawn inside it is the safe area, a quarter inch in from the
 * trimmed edge, which is where Lob says text and faces should stay.
 *
 * Nothing is posted until Save: the file goes up once, with the back, and
 * comes back as a design id the schedule and the cart carry from there.
 */
interface DesignFormProps {
  onSaved: (design: PostcardDesign) => void;
}

interface Picked {
  file: File;
  url: string;
  width: number;
  height: number;
}

export function DesignForm({ onSaved }: DesignFormProps) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [back, setBack] = useState<PostcardBack>(defaultPostcardBack);
  const [savedFlash, setSavedFlash] = useState(false);
  const save = useSaveDesign();
  const fileId = useId();

  const size = PRINT_SIZES[orientation];
  const lowRes = picked !== null && (picked.width < size.width || picked.height < size.height);

  // Object URLs are revoked when the file changes or the form unmounts.
  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.url);
  }, [picked]);

  const previewStyle = useMemo(
    () => ({ aspectRatio: `${size.width} / ${size.height}` }),
    [size],
  );

  const choose = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setPicked({ file, url, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setPicked(null);
    };
    image.src = url;
  };

  const set = <K extends keyof PostcardBack>(key: K, value: PostcardBack[K]) =>
    setBack((current) => ({ ...current, [key]: value }));

  const submit = () => {
    if (!picked) return;
    save.mutate(
      { file: picked.file, orientation, back },
      {
        onSuccess: (design) => {
          onSaved(design);
          setPicked(null);
          setBack(defaultPostcardBack);
          setSavedFlash(true);
          setTimeout(() => setSavedFlash(false), 4000);
        },
      },
    );
  };

  return (
    <div className={cx(styles.form)}>
      <div className={styles.frontRow}>
        <div className={cx(styles.frontPreview)} style={previewStyle}>
          {picked ? (
            <img className={styles.frontImage} src={picked.url} alt="" />
          ) : (
            <div className={styles.frontEmpty}>Your photo goes here</div>
          )}
          <div className={styles.safeArea} aria-hidden />
        </div>

        <div className={styles.frontControls}>
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

          <p className={styles.note}>
            For a sharp print, use a photo at least {size.width} × {size.height} pixels. The inner
            frame is the safe zone — anything outside it may be trimmed.
          </p>

          {lowRes ? (
            <Alert
              type="warning"
              showIcon
              title="This photo is on the small side"
              description={`It is ${picked?.width} × ${picked?.height} pixels, so it will look a little soft when printed.`}
            />
          ) : null}
        </div>
      </div>

      <div className={styles.backRow}>
        <div className={styles.backControls}>
          <label className={styles.field}>
            <span className={styles.label}>Note for the back</span>
            <Input.TextArea
              value={back.text}
              maxLength={600}
              showCount
              autoSize={{ minRows: 4, maxRows: 8 }}
              onChange={(event) => set("text", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Closing line</span>
            <Input
              value={back.valediction}
              maxLength={80}
              placeholder="Love, Rachel"
              onChange={(event) => set("valediction", event.target.value)}
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label} id="font-label">
              Handwriting
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

        <PostcardBackMock back={back} />
      </div>

      {save.isError ? (
        <Alert
          type="error"
          showIcon
          title="That design could not be saved"
          description={save.error instanceof Error ? save.error.message : "Try again."}
        />
      ) : null}

      <div className={styles.actions}>
        <Button type="primary" size="large" disabled={!picked} loading={save.isPending} onClick={submit}>
          {savedFlash ? "Saved!" : "Save this design"}
        </Button>
        <span className={styles.note} role="status">
          {savedFlash
            ? "Added to the schedule below. Save another, or scroll down to add recipients."
            : "Save each design, then choose who gets it and when."}
        </span>
      </div>
    </div>
  );
}
