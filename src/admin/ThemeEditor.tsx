import { Button, Card, ColorPicker, ConfigProvider, Form, Input, Select, Slider, Tag } from "antd";
import type { Theme } from "@shared/schema";
import { toAntdTheme } from "@/lib/theme";
import { cx } from "@/lib/cx";
import styles from "./ThemeEditor.module.css";

/**
 * The store's look, edited against a live preview.
 *
 * v1 exposed the same idea as a colour field wired into `createMuiTheme`, but
 * two global rules in `index.css` — `h2 { color: #000 !important }` and a bare
 * `label` rule — overrode whatever was configured, so the palette a shop set
 * was not the palette it got. Nothing in v2 fights the tokens, which is why a
 * preview is worth showing at all.
 */

const FONT_STACKS = [
  {
    label: "System",
    value:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  { label: "Serif", value: 'Georgia, "Iowan Old Style", "Times New Roman", Times, serif' },
  { label: "Grotesque", value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: "Monospace", value: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace' },
];

const CUSTOM = "__custom__";

interface ThemeEditorProps {
  value: Theme;
  onChange: (theme: Theme) => void;
  /** Shown in the preview so a shop sees its own name in place. */
  storeName: string;
}

export function ThemeEditor({ value, onChange, storeName }: ThemeEditorProps) {
  const preset = FONT_STACKS.find((stack) => stack.value === value.fontFamily);
  const set = <K extends keyof Theme>(key: K, next: Theme[K]) => onChange({ ...value, [key]: next });

  return (
    <div className={cx(styles.layout)}>
      <div className={cx(styles.controls)}>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item
            label="Primary colour"
            help="Buttons, links, and anything the shopper is meant to act on."
          >
            <ColorPicker
              value={value.colorPrimary}
              onChange={(color) => set("colorPrimary", color.toHexString())}
              showText
              disabledAlpha
            />
          </Form.Item>

          <Form.Item label="Accent colour" help="Sale badges, highlights, and small emphasis.">
            <ColorPicker
              value={value.colorAccent}
              onChange={(color) => set("colorAccent", color.toHexString())}
              showText
              disabledAlpha
            />
          </Form.Item>

          <Form.Item label="Typeface">
            <Select
              value={preset ? preset.value : CUSTOM}
              onChange={(next) => {
                // Switching to Custom keeps the current stack as the starting
                // point, so the field is never blanked out under the user.
                if (next !== CUSTOM) set("fontFamily", next);
              }}
              options={[...FONT_STACKS, { label: "Custom…", value: CUSTOM }]}
            />
          </Form.Item>

          {preset ? null : (
            <Form.Item label="Font stack" help="A CSS font-family list. Always end with a generic.">
              <Input
                value={value.fontFamily}
                onChange={(event) => set("fontFamily", event.target.value)}
              />
            </Form.Item>
          )}

          <Form.Item
            label={`Corner radius — ${value.borderRadius}px`}
            help="0 reads as editorial and hard-edged; 12 and above reads as soft and app-like."
          >
            <Slider
              min={0}
              max={24}
              value={value.borderRadius}
              onChange={(next: number) => set("borderRadius", next)}
              // Labelled for anyone driving this from the keyboard.
              tooltip={{ formatter: (px) => `${px ?? 0}px` }}
            />
          </Form.Item>
        </Form>
      </div>

      <div className={cx(styles.preview)}>
        <p className={cx(styles.previewLabel)} id="theme-preview-label">
          Preview
        </p>

        {/* Real components under the real tokens — not a mock-up of them. */}
        <ConfigProvider theme={toAntdTheme(value)}>
          <div
            className={cx(styles.previewSurface)}
            style={{ fontFamily: value.fontFamily }}
            aria-labelledby="theme-preview-label"
          >
            <p className={cx(styles.previewStore)}>{storeName || "Your store"}</p>

            <Card
              size="small"
              cover={
                <div
                  className={cx(styles.previewImage)}
                  style={{ background: value.colorAccent }}
                  aria-hidden="true"
                />
              }
            >
              <p className={cx(styles.previewProduct)}>Canvas Tote</p>
              <p className={cx(styles.previewPrice)}>
                $42.00 <Tag color={value.colorAccent}>New</Tag>
              </p>
              <Button type="primary" block>
                Add to cart
              </Button>
            </Card>
          </div>
        </ConfigProvider>
      </div>
    </div>
  );
}
