import { useEffect, useId } from "react";
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
import { fontUrlSchema, type Theme } from "@shared/schema";
import {
  contrastRatio,
  effectivePageColor,
  googleFontFamilies,
  themeCssVars,
  toAntdTheme,
} from "@/lib/theme";
import { assetUrl } from "@/lib/store-source";
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

/** `["Fraunces"]` → `"Fraunces"`; `["Fraunces", "Inter"]` → `"Fraunces and Inter"`. */
function listFamilies(families: string[]): string {
  return families.length === 1
    ? families[0]!
    : `${families.slice(0, -1).join(", ")} and ${families[families.length - 1]}`;
}

/** Below this, a filled button starts to disappear into the page behind it. */
const MIN_CONTRAST = 3;

interface ThemeEditorProps {
  value: Theme;
  onChange: (theme: Theme) => void;
  /** Shown in the preview so a shop sees its own name in place. */
  storeName: string;
  /**
   * The font URL the store is currently serving, which is the only one its CSP
   * allows. Compared against the edited value to tell the merchant when the
   * preview cannot yet show what they typed — see the note beside it.
   */
  savedFontUrl: string | null;
}

export function ThemeEditor({ value, onChange, storeName, savedFontUrl }: ThemeEditorProps) {
  const { message } = App.useApp();
  const uploadLogo = useUploadLogo();
  const typefaceId = useId();
  const fontUrlId = useId();
  const fontStackId = useId();

  const preset = FONT_STACKS.find((stack) => stack.value === value.fontFamily);
  const set = <K extends keyof Theme>(key: K, next: Theme[K]) => onChange({ ...value, [key]: next });

  const pageColor = effectivePageColor(value);
  const primaryContrast = contrastRatio(value.colorPrimary, pageColor);

  // Checked against the shared schema rather than a second rule here, for the
  // reason `heroHrefSchema` is: the browser and the server must refuse exactly
  // the same strings, and the CSP is built from this value's origin.
  const fontUrlWrong = value.fontUrl !== null && !fontUrlSchema.safeParse(value.fontUrl).success;

  /*
   * A Google Fonts URL names the face it loads; the font stack says which
   * faces the storefront will actually ask for. Neither field knows about the
   * other, so a merchant can paste one and leave the other unchanged — this is
   * the one case where that is provably a mistake: none of the URL's own
   * families appear anywhere in the stack.
   */
  const urlFontFamilies = value.fontUrl ? googleFontFamilies(value.fontUrl) : [];
  const stackLower = value.fontFamily.toLowerCase();
  const unusedFontFamilies =
    urlFontFamilies.length > 0 && urlFontFamilies.every((family) => !stackLower.includes(family.toLowerCase()))
      ? urlFontFamilies
      : [];

  /*
   * Load the face into the admin document so the preview below renders in it.
   *
   * A separate element from the storefront's — see `FONT_LINK_ID` — because
   * this one tracks an unsaved value and must not be mistaken for the one the
   * shop is actually serving.
   */
  useEffect(() => {
    if (fontUrlWrong || !value.fontUrl) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = value.fontUrl;
    document.head.append(link);

    return () => link.remove();
  }, [value.fontUrl, fontUrlWrong]);

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
                title="Your primary colour is hard to see"
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

          <Form.Item label="Logo" help="Replaces the wordmark in the banner.">
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

          {/*
            * `htmlFor`/`id` by hand: every Form.Item in here is unmanaged (no
            * `name`), so antd generates no id to point a label at and the
            * visible "Typeface" was decorative — the combobox reached a
            * screen reader unnamed. A real <label> rather than an aria-label,
            * so the accessible name is the text on screen.
            */}
          <Form.Item label="Typeface" htmlFor={typefaceId}>
            <Select
              id={typefaceId}
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
            <Form.Item label="Font stack" htmlFor={fontStackId} help="A CSS font-family list. Always end with a generic.">
              <Input
                id={fontStackId}
                value={value.fontFamily}
                onChange={(event) => set("fontFamily", event.target.value)}
              />
            </Form.Item>
          )}

          {/*
            * Always shown, preset or not: the four presets above are system
            * stacks, and a merchant who picks one and then wants a real face
            * would otherwise have to switch to Custom to find the field that
            * makes any of it load.
            */}
          <Form.Item
            label="Font stylesheet URL"
            htmlFor={fontUrlId}
            help="Where the browser loads the typeface from. For Google Fonts, paste the <link href>. Leave empty for a system font. The postcard's own faces are always loaded; this URL is for the site's text."
            // The server refuses the same strings — see `fontUrlSchema` — but
            // it also has to fetch the stylesheet to check it, so saying the
            // obvious half here costs the merchant no round trip.
            {...(fontUrlWrong
              ? {
                  validateStatus: "error" as const,
                  extra: "Use an https:// address or a path under /assets/.",
                }
              : unusedFontFamilies.length > 0
                ? {
                    extra: (
                      <Space direction="vertical" size="small">
                        <span>
                          This stylesheet defines {listFamilies(unusedFontFamilies)}, which the
                          typeface above does not use.
                        </span>
                        <Button
                          size="small"
                          onClick={() => {
                            const custom = [
                              ...unusedFontFamilies.map((family) => `"${family}"`),
                              value.fontFamily,
                            ].join(", ");
                            set("fontFamily", custom);
                          }}
                        >
                          Switch Typeface to Custom…
                        </Button>
                      </Space>
                    ),
                  }
                : {})}
          >
            <Input
              id={fontUrlId}
              value={value.fontUrl ?? ""}
              placeholder="https://fonts.googleapis.com/css2?family=Fraunces&display=swap"
              onChange={(event) => {
                const next = event.target.value.trim();
                // Empty means "system font", which is null and not "": the
                // column is nullable and a blank string would be a URL the
                // browser resolves against the current page.
                set("fontUrl", next === "" ? null : next);
              }}
            />
          </Form.Item>

          <Form.Item
            label={`Corner radius — ${value.borderRadius}px`}
            help="0 reads as editorial and hard-edged; 4 is as soft as the site goes."
          >
            <Slider
              /*
               * The handle is a <div role="slider">, so there is nothing for a
               * <label> to point at and the label above it does not carry. The
               * px value is already announced from aria-valuenow, which is why
               * this is the bare noun and not the label's full text.
               */
              ariaLabelForHandle="Corner radius"
              min={0}
              max={4}
              value={value.borderRadius}
              onChange={(next: number) => set("borderRadius", next)}
              // Shows the px value on drag. It is not what names the handle
              // for a screen reader — `ariaLabelForHandle` above is.
              tooltip={{ formatter: (px) => `${px ?? 0}px` }}
            />
          </Form.Item>
        </Form>
      </div>

      <div className={cx(styles.preview)}>
        <p className={cx(styles.previewLabel)} id="theme-preview-label">
          Preview
        </p>

        {/*
          * The one thing the preview cannot show honestly.
          *
          * A store's Content-Security-Policy names the font host it has saved,
          * and nothing else — that is what stops any other page from loading
          * fonts, and it applies to this page too. So a URL that has not been
          * saved yet is refused by the browser and the preview keeps the
          * fallback face. Said out loud here, because a preview that silently
          * ignores the field is worse than one that explains itself.
          */}
        {value.fontUrl && value.fontUrl !== savedFontUrl ? (
          <Alert
            type="info"
            showIcon
            className={cx(styles.previewNote)}
            title="Save to see this typeface"
            description="The site only allows fonts from an address it has saved, so the preview keeps the fallback until you do."
          />
        ) : null}

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

            <div className={cx(styles.previewCard)}>
              <p className={cx(styles.previewHeading)}>Make a postcard</p>
              <p className={cx(styles.previewText)}>
                Upload a photo, write a note, and pick the days it goes out.
              </p>
              <span className={cx(styles.previewAccent)}>$1.40 each</span>
            </div>

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
