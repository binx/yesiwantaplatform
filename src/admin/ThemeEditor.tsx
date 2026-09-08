import {
  Alert,
  App,
  Button,
  ColorPicker,
  ConfigProvider,
  Form,
  Input,
  Segmented,
  Select,
  Slider,
  Space,
  Upload,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { Theme } from "@shared/schema";
import { contrastRatio, effectivePageColor, themeCssVars, toAntdTheme } from "@/lib/theme";
import { assetUrl } from "@/lib/store-source";
import { ProductCard } from "@/components/product/ProductCard";
import { cx } from "@/lib/cx";
import { useUploadLogo } from "./queries";
import styles from "./ThemeEditor.module.css";

/**
 * The store's look, edited against a live preview.
 *
 * v1 exposed the same idea as a colour field wired into `createMuiTheme`, but
 * two global rules in `index.css` — `h2 { color: #000 !important }` and a bare
 * `label` rule — overrode whatever was configured, so the palette a shop set
 * was not the palette it got.
 *
 * v2 had a subtler version of the same bug: the preview drew a bespoke antd
 * Card and Tag, so it advertised an accent colour that no storefront surface
 * actually used. The preview now renders the real `ProductCard` under the real
 * CSS variables, which means it can only be wrong if the storefront is wrong
 * too.
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

/** Below this, a filled button starts to disappear into the page behind it. */
const MIN_CONTRAST = 3;

interface ThemeEditorProps {
  value: Theme;
  onChange: (theme: Theme) => void;
  /** Shown in the preview so a shop sees its own name in place. */
  storeName: string;
}

export function ThemeEditor({ value, onChange, storeName }: ThemeEditorProps) {
  const { message } = App.useApp();
  const uploadLogo = useUploadLogo();

  const preset = FONT_STACKS.find((stack) => stack.value === value.fontFamily);
  const set = <K extends keyof Theme>(key: K, next: Theme[K]) => onChange({ ...value, [key]: next });

  const pageColor = effectivePageColor(value);
  const primaryContrast = contrastRatio(value.colorPrimary, pageColor);

  return (
    <div className={cx(styles.layout)}>
      <div className={cx(styles.controls)}>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Colour scheme" help="Every shopper sees the one you pick.">
            <Segmented
              value={value.colorScheme}
              onChange={(next) => set("colorScheme", next as Theme["colorScheme"])}
              options={[
                { label: "Light", value: "light" },
                { label: "Dark", value: "dark" },
              ]}
            />
          </Form.Item>

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

          {primaryContrast < MIN_CONTRAST && (
            <Form.Item>
              <Alert
                type="warning"
                showIcon
                message="Your primary colour is hard to see"
                description={`Buttons sit at ${primaryContrast.toFixed(1)}:1 against the page background. Below ${MIN_CONTRAST}:1 they start to disappear — a near-black primary on a dark scheme is the usual cause.`}
              />
            </Form.Item>
          )}

          <Form.Item label="Accent colour" help="Sale badges, highlights, and small emphasis.">
            <ColorPicker
              value={value.colorAccent}
              onChange={(color) => set("colorAccent", color.toHexString())}
              showText
              disabledAlpha
            />
          </Form.Item>

          <Form.Item
            label="Page background"
            help={value.colorPage ? undefined : "Following the colour scheme."}
          >
            <Space>
              <ColorPicker
                value={pageColor}
                onChange={(color) => set("colorPage", color.toHexString())}
                showText
                disabledAlpha
              />
              <Button
                type="link"
                size="small"
                disabled={value.colorPage === null}
                onClick={() => set("colorPage", null)}
              >
                Match scheme
              </Button>
            </Space>
          </Form.Item>

          <Form.Item label="Logo" help="Replaces the store name in the banner.">
            <Space>
              <Upload
                accept="image/*"
                showUploadList={false}
                beforeUpload={(file) => {
                  uploadLogo.mutate(
                    { file, alt: `${storeName || "Store"} logo` },
                    {
                      onSuccess: (image) => set("logo", image),
                      onError: () => {
                        message.error("That logo could not be uploaded.");
                      },
                    },
                  );
                  // Handed to the mutation above; antd's own uploader stays out.
                  return Upload.LIST_IGNORE;
                }}
              >
                <Button icon={<UploadOutlined />} loading={uploadLogo.isPending}>
                  {value.logo ? "Replace" : "Upload"}
                </Button>
              </Upload>

              {value.logo && (
                <Button type="link" size="small" onClick={() => set("logo", null)}>
                  Remove
                </Button>
              )}
            </Space>
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
            help="0 reads as editorial and hard-edged; 4 is as soft as the storefront goes."
          >
            <Slider
              min={0}
              max={4}
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

        {/* The storefront's own card and variables, not a mock-up of them. */}
        <ConfigProvider theme={toAntdTheme(value)}>
          <div
            className={cx(styles.previewSurface)}
            style={{ ...themeCssVars(value), fontFamily: value.fontFamily }}
            aria-labelledby="theme-preview-label"
          >
            {value.logo ? (
              <img
                className={cx(styles.previewLogo)}
                src={assetUrl(value.logo.path)}
                alt={value.logo.alt}
              />
            ) : (
              <p className={cx(styles.previewStore)}>{storeName || "Your store"}</p>
            )}

            <ProductCard href="#" name="Canvas Tote" price="$42.00" soldOut />

            <div className={cx(styles.previewAction)}>
              <Button type="primary" block>
                Add to cart
              </Button>
            </div>
          </div>
        </ConfigProvider>
      </div>
    </div>
  );
}
