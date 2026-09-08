import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Radio,
  Skeleton,
  Space,
  Switch,
  Tooltip,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { ProductInput, VariantInput } from "@shared/api";
import type { Image, OptionGroup } from "@shared/schema";
import { formatMoney, parseCents } from "@shared/money";
import { ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import {
  useCreateProduct,
  useEnvironment,
  useProduct,
  usePublishProduct,
  useSettings,
  useShipping,
  useUpdateProduct,
} from "./queries";
import { PageHeader } from "./RequireAdmin";
import { Field } from "./Field";
import { ImageManager } from "./ImageManager";
import { SaveIndicator } from "./SaveIndicator";
import { useAutosave } from "./useAutosave";
import styles from "./ProductEditorPage.module.css";

/**
 * One product, one form.
 *
 * This replaces v1's four-step `Stepper`, which was the root of a whole family
 * of bugs rather than one:
 *
 *   - MUI mounted every `StepContent` at once, so step 2 fetched
 *     `/product-info/undefined` on mount and never refetched (finding 22);
 *   - each step wrote to Stripe immediately, so abandoning the wizard left
 *     orphaned Stripe Products behind;
 *   - changing a single price meant clicking through four screens.
 *
 * The model here is a local draft that autosaves to our own database, and a
 * Publish button that is the only thing which ever touches Stripe.
 */

interface DraftVariant {
  /** Stable across re-renders and reorders; not persisted. */
  key: string;
  id?: string;
  label: string;
  /** Kept as text so a half-typed "19." is not destroyed mid-edit. */
  priceText: string;
  infinite: boolean;
  quantity: number;
  /** Grams. Only consulted by weight-banded shipping rates. */
  weightGrams: number;
}

interface Draft {
  slug: string;
  name: string;
  description: string;
  bulletPoints: string[];
  /** Empty means "generate it", which is what the fields preview. */
  seoTitle: string;
  seoDescription: string;
  variantName: string;
  variants: DraftVariant[];
  optionGroups: OptionGroup[];
  isLive: boolean;
}

let keyCounter = 0;
const nextKey = () => `v${++keyCounter}`;

/** A URL-safe slug from a product name. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const EMPTY_DRAFT: Draft = {
  slug: "",
  name: "",
  description: "",
  bulletPoints: [],
  seoTitle: "",
  seoDescription: "",
  variantName: "",
  variants: [{ key: nextKey(), label: "", priceText: "", infinite: true, quantity: 0, weightGrams: 0 }],
  optionGroups: [],
  isLive: false,
};

/** Cents for a variant, or null when the text is not a valid amount. */
function variantCents(variant: DraftVariant): number | null {
  const cents = parseCents(variant.priceText);
  return cents === null || cents < 0 ? null : cents;
}

function toInput(draft: Draft): ProductInput {
  return {
    slug: draft.slug,
    name: draft.name.trim(),
    description: draft.description,
    bulletPoints: draft.bulletPoints.filter((point) => point.trim() !== ""),
    // Empty is stored as null so the server can tell "no override" from "".
    seoTitle: draft.seoTitle.trim() || null,
    seoDescription: draft.seoDescription.trim() || null,
    variantName: draft.variantName.trim() || null,
    variants: draft.variants.map(
      (variant): VariantInput => ({
        ...(variant.id ? { id: variant.id } : {}),
        label: variant.label.trim(),
        priceCents: variantCents(variant) ?? 0,
        inventory: variant.infinite
          ? { type: "infinite" }
          : { type: "finite", quantity: Math.max(0, Math.trunc(variant.quantity)) },
        weightGrams: Math.max(0, Math.trunc(variant.weightGrams)),
      }),
    ),
    optionGroups: draft.optionGroups
      .filter((group) => group.name.trim() !== "" && group.choices.length > 0)
      .map((group) => ({
        name: group.name.trim(),
        choices: group.choices.filter((choice) => choice.trim() !== ""),
      })),
    isLive: draft.isLive,
  };
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Problem {
  field: string;
  message: string;
}

/** Everything the API would reject, plus the things it accepts but shouldn't. */
function problems(draft: Draft): Problem[] {
  const found: Problem[] = [];

  if (draft.name.trim() === "") found.push({ field: "name", message: "A product needs a name." });

  if (!SLUG_PATTERN.test(draft.slug)) {
    found.push({
      field: "slug",
      message: "The web address must be lowercase words separated by hyphens.",
    });
  }

  if (draft.variants.length === 0) {
    found.push({ field: "variants", message: "A product needs at least one price." });
  }

  draft.variants.forEach((variant, index) => {
    if (variantCents(variant) === null) {
      found.push({ field: `variant-${index}`, message: `Price ${index + 1} is not an amount.` });
    }
  });

  /*
   * The storefront labels its variant picker with `variantName`. v1 hid the
   * picker entirely when a product had exactly one variant *group*, so a
   * customer choosing between S, M and L silently got S (finding 8). An
   * unlabelled axis is the same failure one step earlier, so it is an error
   * rather than a suggestion.
   */
  if (draft.variants.length > 1 && draft.variantName.trim() === "") {
    found.push({
      field: "variantName",
      message: "Several prices need a label for the choice, like “Size” — shoppers pick by it.",
    });
  }

  const labels = draft.variants.map((variant) => variant.label.trim());
  if (draft.variants.length > 1 && new Set(labels).size !== labels.length) {
    found.push({ field: "variants", message: "Two options share a label, so they cannot be told apart." });
  }

  return found;
}

export function ProductEditorPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();

  const isNew = slug === undefined;
  const loaded = useProduct(slug);
  const settings = useSettings();
  const environment = useEnvironment();
  const shipping = useShipping();

  const create = useCreateProduct();
  const update = useUpdateProduct();
  const publish = usePublishProduct();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [productId, setProductId] = useState<string | null>(null);
  const [images, setImages] = useState<Image[]>([]);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const hydrated = useRef(false);

  const currency = settings.data?.currency ?? "USD";
  // Only nag about weights when some rate would actually read them.
  const weighted =
    shipping.data?.rates.some((r) => r.minWeightGrams !== null || r.maxWeightGrams !== null) ??
    false;

  /* --- load ------------------------------------------------------------- */

  useEffect(() => {
    if (isNew || !loaded.data || hydrated.current) return;

    const product = loaded.data;
    hydrated.current = true;

    setProductId(product.id);
    setImages(product.images);
    setDraft({
      slug: product.slug,
      name: product.name,
      description: product.description,
      bulletPoints: product.bulletPoints,
      seoTitle: product.seoTitle ?? "",
      seoDescription: product.seoDescription ?? "",
      variantName: product.variantName ?? "",
      variants: product.variants.map((variant) => ({
        key: nextKey(),
        id: variant.id,
        label: variant.label,
        priceText: (variant.priceCents / 100).toFixed(2),
        infinite: variant.inventory.type === "infinite",
        quantity: variant.inventory.type === "finite" ? variant.inventory.quantity : 0,
        weightGrams: variant.weightGrams,
      })),
      optionGroups: product.optionGroups,
      isLive: product.isLive,
    });
  }, [isNew, loaded.data]);

  useEffect(() => {
    document.title = `${draft.name || "New product"} · Beluga`;
  }, [draft.name]);

  /* --- autosave ---------------------------------------------------------- */

  const issues = useMemo(() => problems(draft), [draft]);
  const valid = issues.length === 0;

  const save = useCallback(
    async (value: Draft) => {
      const input = toInput(value);

      if (productId) {
        await update.mutateAsync({ id: productId, input });
        return;
      }

      const { id } = await create.mutateAsync(input);
      setProductId(id);
    },
    [productId, create, update],
  );

  const autosave = useAutosave({ value: draft, enabled: valid, save });
  const { markSaved, flush } = autosave;

  /*
   * Adopt the loaded product as the save baseline.
   *
   * This has to wait for the render that *applies* the hydrated draft, not the
   * effect that sets it: `markSaved` records whatever the hook is currently
   * holding, and during the hydrating pass that is still the empty draft. Run
   * a tick early and the editor treats the product it just loaded as an unsaved
   * change and writes it straight back — harmless, but a needless request on
   * every open, and "Saved just now" appears when nothing was saved.
   */
  const baselined = useRef(false);

  useEffect(() => {
    if (!hydrated.current || baselined.current) return;
    baselined.current = true;
    markSaved();
  }, [draft, markSaved]);

  /*
   * Keep the address bar honest after a rename.
   *
   * The route is by slug, so a saved slug change makes the current URL a 404
   * on reload. Replaced rather than pushed: this is not a navigation the user
   * performed, and it should not cost them a Back press.
   */
  useEffect(() => {
    if (!productId || autosave.state !== "saved") return;
    if (!SLUG_PATTERN.test(draft.slug)) return;

    const target = `/admin/products/${draft.slug}`;
    if (window.location.pathname !== target) void navigate(target, { replace: true });
  }, [autosave.state, draft.slug, productId, navigate]);

  // Leaving the page must not silently drop the last edit.
  useEffect(() => () => void flush(), [flush]);

  /* --- editing helpers --------------------------------------------------- */

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const setVariant = (key: string, patch: Partial<DraftVariant>) =>
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((variant) =>
        variant.key === key ? { ...variant, ...patch } : variant,
      ),
    }));

  const onPublish = () => {
    if (!productId) return;

    const live = environment.data?.stripeMode === "live";

    const run = () =>
      flush().then(() =>
        publish.mutate(productId, {
          onSuccess: (result) =>
            void message.success(
              result.pricesCreated > 0
                ? `Published — ${result.pricesCreated} price${result.pricesCreated === 1 ? "" : "s"} created in Stripe.`
                : "Published — Stripe was already up to date.",
            ),
          onError: (error: unknown) =>
            void message.error(error instanceof Error ? error.message : "Could not publish."),
        }),
      );

    if (!live) return void run();

    modal.confirm({
      title: "Publish to a live Stripe account?",
      okText: "Publish",
      content:
        "This creates real Products and Prices in your live Stripe account. Prices are immutable, so changing an amount later archives the old one rather than editing it.",
      onOk: run,
    });
  };

  /* --- render ------------------------------------------------------------ */

  if (!isNew && loaded.isPending) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (!isNew && loaded.isError) {
    const status = loaded.error instanceof ApiError ? loaded.error.status : 0;
    return (
      <Empty
        description={status === 404 ? "No product at this address." : "Could not load the product."}
      >
        <Link to="/admin/products">
          <Button>Back to products</Button>
        </Link>
      </Empty>
    );
  }

  const canPublish = Boolean(productId) && (environment.data?.hasStripeSecret ?? false);

  return (
    <>
      <PageHeader
        title={draft.name.trim() || "New product"}
        description={<SaveIndicator autosave={autosave} valid={valid} />}
        actions={
          <>
            {productId && draft.isLive ? (
              <a href={`/product/${draft.slug}`} target="_blank" rel="noreferrer">
                View on storefront ↗
              </a>
            ) : null}

            <Tooltip
              title={
                canPublish
                  ? "Create or update this product's Stripe Product and Prices."
                  : productId
                    ? "Stripe is not connected. Set STRIPE_SECRET_KEY to publish."
                    : "Save the product first."
              }
            >
              <Button onClick={onPublish} disabled={!canPublish} loading={publish.isPending}>
                Publish to Stripe
              </Button>
            </Tooltip>

            <Link to="/admin/products">
              <Button>Done</Button>
            </Link>
          </>
        }
      />

      {autosave.state === "error" ? (
        <Alert
          className={cx(styles.alert)}
          type="error"
          showIcon
          title="The last change could not be saved"
          description={autosave.error?.message}
          action={
            <Button size="small" onClick={() => void flush()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {issues.length > 0 ? (
        <Alert
          className={cx(styles.alert)}
          type="warning"
          showIcon
          title="Not saved yet"
          description={
            <ul className={cx(styles.issues)}>
              {issues.map((issue) => (
                <li key={issue.field + issue.message}>{issue.message}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      <div className={cx(styles.columns)}>
        <div className={cx(styles.main)}>
          <Card title="Basics" className={cx(styles.card)}>
            <Field label="Name">
              {(control) => (
              <Input
                {...control}
                value={draft.name}
                autoFocus={isNew}
                onChange={(event) => {
                  const name = event.target.value;
                  setDraft((current) => ({
                    ...current,
                    name,
                    // The slug follows the name until it is edited by hand,
                    // and never afterwards — a live product's address should
                    // not change because someone fixed a typo in its title.
                    slug: slugTouched ? current.slug : slugify(name),
                  }));
                }}
              />
              )}
            </Field>

            <Field
              label="Web address"
              help="Changing this on a live product breaks any link anyone has saved."
            >
              {(control) => (
                <Input
                  {...control}
                  value={draft.slug}
                  // `prefix`, not the deprecated `addonBefore`: it also keeps
                  // the path and the slug in one box rather than two.
                  prefix={<span className={cx(styles.slugPrefix)}>/product/</span>}
                  onChange={(event) => {
                    setSlugTouched(true);
                    set("slug", event.target.value);
                  }}
                  onBlur={(event) => set("slug", slugify(event.target.value))}
                />
              )}
            </Field>

            <Field label="Description">
              {(control) => (
                <Input.TextArea
                  {...control}
                  value={draft.description}
                  onChange={(event) => set("description", event.target.value)}
                  autoSize={{ minRows: 4, maxRows: 14 }}
                />
              )}
            </Field>

            <fieldset className={cx(styles.fieldset)}>
              <legend className={cx(styles.label)}>Bullet points</legend>
              {draft.bulletPoints.map((point, index) => (
                <div key={index} className={cx(styles.row)}>
                  <Input
                    value={point}
                    aria-label={`Bullet point ${index + 1}`}
                    onChange={(event) =>
                      set(
                        "bulletPoints",
                        draft.bulletPoints.map((existing, i) =>
                          i === index ? event.target.value : existing,
                        ),
                      )
                    }
                  />
                  <Button
                    icon={<DeleteOutlined />}
                    aria-label={`Remove bullet point ${index + 1}`}
                    onClick={() =>
                      set(
                        "bulletPoints",
                        draft.bulletPoints.filter((_point, i) => i !== index),
                      )
                    }
                  />
                </div>
              ))}
              <Button
                icon={<PlusOutlined />}
                onClick={() => set("bulletPoints", [...draft.bulletPoints, ""])}
              >
                Add a bullet point
              </Button>
            </fieldset>
          </Card>

          <Card title="Prices and stock" className={cx(styles.card)}>
            <p className={cx(styles.cardIntro)}>
              One row per thing a shopper can buy separately. Two sizes at different prices are two
              rows; a colour that costs the same is an option below.
            </p>

            {draft.variants.length > 1 ? (
              <Field
                label="What are they choosing between?"
                help="Labels the picker on the product page. Without it, shoppers cannot tell what the choice means."
              >
                {(control) => (
                  <Input
                    {...control}
                    value={draft.variantName}
                    placeholder="Size"
                    onChange={(event) => set("variantName", event.target.value)}
                  />
                )}
              </Field>
            ) : null}

            <ul className={cx(styles.variants)}>
              {draft.variants.map((variant, index) => {
                const cents = variantCents(variant);

                return (
                  <li key={variant.key} className={cx(styles.variant)}>
                    {draft.variants.length > 1 ? (
                      <div className={cx(styles.variantField)}>
                        <Field label={draft.variantName.trim() || "Option"}>
                          {(control) => (
                            <Input
                              {...control}
                              value={variant.label}
                              placeholder="Medium"
                              onChange={(event) =>
                                setVariant(variant.key, { label: event.target.value })
                              }
                            />
                          )}
                        </Field>
                      </div>
                    ) : null}

                    <div className={cx(styles.variantField)}>
                      <Field
                        label="Price"
                        {...(variant.priceText !== "" && cents === null
                          ? { error: "Not a valid amount." }
                          : {
                              /*
                               * Shows the integer cents that will actually be
                               * stored. v1 kept prices as floats and multiplied
                               * by 100 at the boundary, so 19.99 reached Stripe
                               * as 1998.9999999999998.
                               */
                              help:
                                cents === null
                                  ? "Whole units and cents, like 19.99."
                                  : `${formatMoney(cents, currency)} — stored as ${cents} cents`,
                            })}
                      >
                        {(control) => (
                          <Input
                            {...control}
                            value={variant.priceText}
                            inputMode="decimal"
                            prefix={currency}
                            placeholder="19.99"
                            status={variant.priceText !== "" && cents === null ? "error" : ""}
                            onChange={(event) =>
                              setVariant(variant.key, { priceText: event.target.value })
                            }
                          />
                        )}
                      </Field>
                    </div>

                    {/*
                      * A radio group is labelled by an element, not by `for` —
                      * there is no single control to point at — so it gets a
                      * real group role and `aria-labelledby`.
                      */}
                    <div
                      className={cx(styles.variantField)}
                      role="group"
                      aria-labelledby={`stock-${variant.key}`}
                    >
                      <span className={cx(styles.label)} id={`stock-${variant.key}`}>
                        Stock
                      </span>
                      <Radio.Group
                        value={variant.infinite ? "infinite" : "finite"}
                        onChange={(event) =>
                          setVariant(variant.key, { infinite: event.target.value === "infinite" })
                        }
                        options={[
                          { label: "Unlimited", value: "infinite" },
                          { label: "Limited", value: "finite" },
                        ]}
                        optionType="button"
                      />
                      {variant.infinite ? null : (
                        <InputNumber
                          className={cx(styles.quantity)}
                          min={0}
                          precision={0}
                          value={variant.quantity}
                          aria-label={`Quantity in stock for option ${index + 1}`}
                          onChange={(value) => setVariant(variant.key, { quantity: value ?? 0 })}
                        />
                      )}
                    </div>

                    <div className={cx(styles.variantField)}>
                      <Field
                        label="Weight"
                        help={
                          weighted
                            ? "Used to pick a shipping band."
                            : "Optional — only weight-based shipping rates read it."
                        }
                      >
                        {(control) => (
                          <InputNumber
                            {...control}
                            className={cx(styles.quantity)}
                            min={0}
                            precision={0}
                            addonAfter="g"
                            value={variant.weightGrams}
                            onChange={(value) =>
                              setVariant(variant.key, { weightGrams: value ?? 0 })
                            }
                          />
                        )}
                      </Field>
                    </div>

                    {draft.variants.length > 1 ? (
                      <Button
                        className={cx(styles.variantRemove)}
                        icon={<DeleteOutlined />}
                        aria-label={`Remove option ${index + 1}`}
                        onClick={() =>
                          set(
                            "variants",
                            draft.variants.filter((item) => item.key !== variant.key),
                          )
                        }
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <Button
              icon={<PlusOutlined />}
              onClick={() =>
                set("variants", [
                  ...draft.variants,
                  { key: nextKey(), label: "", priceText: "", infinite: true, quantity: 0, weightGrams: 0 },
                ])
              }
            >
              Add another option
            </Button>
          </Card>

          <Card title="Choices that don't change the price" className={cx(styles.card)}>
            <p className={cx(styles.cardIntro)}>
              Gift wrap, a monogram, a colour that costs the same. These are recorded on the order
              but have no separate price or stock of their own.
            </p>

            {draft.optionGroups.map((group, index) => (
              <div key={index} className={cx(styles.optionGroup)}>
                <div className={cx(styles.row)}>
                  <Input
                    value={group.name}
                    placeholder="Gift wrap"
                    aria-label={`Choice ${index + 1} name`}
                    onChange={(event) =>
                      set(
                        "optionGroups",
                        draft.optionGroups.map((existing, i) =>
                          i === index ? { ...existing, name: event.target.value } : existing,
                        ),
                      )
                    }
                  />
                  <Button
                    icon={<DeleteOutlined />}
                    aria-label={`Remove choice ${index + 1}`}
                    onClick={() =>
                      set(
                        "optionGroups",
                        draft.optionGroups.filter((_group, i) => i !== index),
                      )
                    }
                  />
                </div>
                <Field label="Options, separated by commas">
                  {(control) => (
                  <Input
                    {...control}
                    value={group.choices.join(", ")}
                    placeholder="Yes, No"
                    onChange={(event) =>
                      set(
                        "optionGroups",
                        draft.optionGroups.map((existing, i) =>
                          i === index
                            ? {
                                ...existing,
                                choices: event.target.value.split(",").map((c) => c.trim()),
                              }
                            : existing,
                        ),
                      )
                    }
                  />
                  )}
                </Field>
              </div>
            ))}

            <Button
              icon={<PlusOutlined />}
              onClick={() => set("optionGroups", [...draft.optionGroups, { name: "", choices: [] }])}
            >
              Add a choice
            </Button>
          </Card>
        </div>

        <div className={cx(styles.side)}>
          <Card title="Visibility" className={cx(styles.card)}>
            <Space align="start">
              <Switch
                checked={draft.isLive}
                onChange={(checked) => set("isLive", checked)}
                aria-label="Show on the storefront"
              />
              <div>
                <p className={cx(styles.switchLabel)}>
                  {draft.isLive ? "Live on the storefront" : "Draft"}
                </p>
                <p className={cx(styles.help)}>
                  {draft.isLive
                    ? "Visible to shoppers and listed in the shop."
                    : "Editable here, and invisible to everyone else."}
                </p>
              </div>
            </Space>
          </Card>

          <Card title="Search appearance" className={cx(styles.card)}>
            <p className={cx(styles.help)}>
              What Google and link previews show. Leave either blank to use the generated
              version below it.
            </p>

            <Field
              label="Title"
              help={`${draft.seoTitle.length}/70 · Google truncates past 70 characters.`}
            >
              {(control) => (
                <Input
                  {...control}
                  value={draft.seoTitle}
                  maxLength={70}
                  placeholder={draft.name.trim() ? `${draft.name.trim()} · your store` : "Product name · your store"}
                  onChange={(event) => set("seoTitle", event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Description"
              help={`${draft.seoDescription.length}/160 · Google truncates past 160 characters.`}
            >
              {(control) => (
                <Input.TextArea
                  {...control}
                  value={draft.seoDescription}
                  maxLength={160}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder={
                    draft.description.trim()
                      ? draft.description.trim().slice(0, 157)
                      : "The first 160 characters of the description."
                  }
                  onChange={(event) => set("seoDescription", event.target.value)}
                />
              )}
            </Field>
          </Card>

          <Card title="Images" className={cx(styles.card)}>
            <ImageManager productId={productId} images={images} onChange={setImages} />
          </Card>
        </div>
      </div>
    </>
  );
}
