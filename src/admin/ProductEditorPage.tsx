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
import type { Image, OptionGroup, ProductKind } from "@shared/schema";
import { formatMoney, parseCents } from "@shared/money";
import { findDuplicateCombination, optionSelectionsAreWellFormed } from "@shared/product-options";
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
  useStoreLocale,
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

/** A value on an axis: "Large". Identity is the key, not the text, so a rename never loses a variant's price and stock. */
interface DraftValue {
  key: string;
  text: string;
}

/** A priced axis: "Size". Up to three per product. */
interface DraftOption {
  key: string;
  id?: string;
  name: string;
  values: DraftValue[];
}

interface DraftVariant {
  /** Stable across re-renders and matrix regeneration; not persisted. */
  key: string;
  id?: string;
  /** optionKey -> valueKey, one entry per axis in `Draft.options`. */
  selections: Record<string, string>;
  /** Kept as text so a half-typed "19." is not destroyed mid-edit. */
  priceText: string;
  sku: string;
  /** Kept as text for the same reason priceText is. Empty means no sale. */
  compareAtText: string;
  infinite: boolean;
  quantity: number;
  /** Grams. Only consulted by weight-banded shipping rates. */
  weightGrams: number;
  /** Whether this row has already been pushed to Stripe — informs the removal warning. */
  stripePriceId: string | null;
}

interface Draft {
  slug: string;
  name: string;
  kind: ProductKind;
  description: string;
  bulletPoints: string[];
  /** Empty means "generate it", which is what the fields preview. */
  seoTitle: string;
  seoDescription: string;
  /** Stripe tax code. Empty uses the store default. */
  taxCode: string;
  options: DraftOption[];
  variants: DraftVariant[];
  optionGroups: OptionGroup[];
  isLive: boolean;
}

let keyCounter = 0;
const nextKey = () => `k${++keyCounter}`;

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

function blankVariant(): DraftVariant {
  return {
    key: nextKey(),
    selections: {},
    priceText: "",
    sku: "",
    compareAtText: "",
    infinite: true,
    quantity: 0,
    weightGrams: 0,
    stripePriceId: null,
  };
}

const EMPTY_DRAFT: Draft = {
  slug: "",
  name: "",
  kind: "physical",
  description: "",
  bulletPoints: [],
  seoTitle: "",
  seoDescription: "",
  taxCode: "",
  options: [],
  variants: [blankVariant()],
  optionGroups: [],
  isLive: false,
};

/**
 * Recompute the matrix from the current options: one row per combination of
 * axis values, in axis order.
 *
 * A combination that already has a row keeps it — same key, same id, same
 * price, stock and weight — matched by *value identity* (the key), not text,
 * so renaming a value never loses its price. A variant that predates an axis
 * (it has no selection on that axis at all) is carried into that axis's first
 * value rather than dropped outright, so adding a second axis to a simple
 * product does not blank out every price that already existed.
 */
function regenerateVariants(options: DraftOption[], existing: DraftVariant[]): DraftVariant[] {
  if (options.length === 0) {
    return [existing[0] ?? blankVariant()];
  }

  let combos: string[][] = [[]];
  for (const option of options) {
    const next: string[][] = [];
    for (const combo of combos) {
      for (const value of option.values) next.push([...combo, value.key]);
    }
    combos = next;
  }

  const findMatch = (comboKeys: string[]): DraftVariant | undefined =>
    existing.find((variant) =>
      options.every((option, index) => {
        const selected = variant.selections[option.key];
        // Predates this axis: only adopt it at the axis's first value.
        if (selected === undefined) return option.values[0]?.key === comboKeys[index];
        return selected === comboKeys[index];
      }),
    );

  return combos.map((comboKeys) => {
    const match = findMatch(comboKeys);
    const selections: Record<string, string> = {};
    options.forEach((option, index) => {
      selections[option.key] = comboKeys[index]!;
    });

    return match ? { ...match, selections } : { ...blankVariant(), selections };
  });
}

/** A saved variant with stock or a Stripe price — losing it is destructive. */
function hasStockOrSales(variant: DraftVariant): boolean {
  return Boolean(variant.id) && (variant.infinite || variant.quantity > 0 || variant.stripePriceId !== null);
}

/** Cents for a variant, or null when the text is not a valid amount. */
function variantCents(variant: DraftVariant): number | null {
  const cents = parseCents(variant.priceText);
  return cents === null || cents < 0 ? null : cents;
}

/** Cents for a variant's compare-at price. Null means "not set" or invalid. */
function variantCompareAtCents(variant: DraftVariant): number | null {
  if (variant.compareAtText.trim() === "") return null;
  const cents = parseCents(variant.compareAtText);
  return cents === null || cents < 0 ? null : cents;
}

function comboLabel(options: DraftOption[], variant: DraftVariant): string {
  return options
    .map((option) => option.values.find((v) => v.key === variant.selections[option.key])?.text.trim() || "—")
    .join(" / ");
}

function toInput(draft: Draft): ProductInput {
  const options = draft.options.map((option) => ({
    ...(option.id ? { id: option.id } : {}),
    name: option.name.trim(),
    values: option.values.map((value) => value.text.trim()),
  }));

  return {
    slug: draft.slug,
    name: draft.name.trim(),
    kind: draft.kind,
    description: draft.description,
    bulletPoints: draft.bulletPoints.filter((point) => point.trim() !== ""),
    // Empty is stored as null so the server can tell "no override" from "".
    seoTitle: draft.seoTitle.trim() || null,
    seoDescription: draft.seoDescription.trim() || null,
    // Empty is stored as null, so "no override" is distinguishable from "".
    taxCode: draft.taxCode.trim() || null,
    options,
    variants: draft.variants.map((variant): VariantInput => {
      const optionValues = draft.options.map(
        (option) => option.values.find((v) => v.key === variant.selections[option.key])?.text.trim() ?? "",
      );

      return {
        ...(variant.id ? { id: variant.id } : {}),
        // The server regenerates this from optionValues whenever there are
        // any options; it only matters here for a product with none.
        label: "",
        priceCents: variantCents(variant) ?? 0,
        sku: variant.sku.trim() === "" ? null : variant.sku.trim(),
        compareAtPriceCents: variantCompareAtCents(variant),
        inventory: variant.infinite
          ? { type: "infinite" }
          : { type: "finite", quantity: Math.max(0, Math.trunc(variant.quantity)) },
        weightGrams: Math.max(0, Math.trunc(variant.weightGrams)),
        optionValues,
      };
    }),
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
const TAX_CODE_PATTERN = /^txcd_[0-9]+$/;

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

  if (draft.variants.length > 50) {
    found.push({
      field: "variants",
      message: "A product can have at most 50 prices — remove an option or a value.",
    });
  }

  draft.variants.forEach((variant, index) => {
    if (variantCents(variant) === null) {
      found.push({ field: `variant-${index}`, message: `Price ${index + 1} is not an amount.` });
    }

    if (variant.compareAtText.trim() !== "") {
      const compareAt = variantCompareAtCents(variant);
      const price = variantCents(variant);
      if (compareAt === null) {
        found.push({
          field: `variant-compare-at-${index}`,
          message: `The compare-at price for ${index + 1} is not an amount.`,
        });
      } else if (price !== null && compareAt <= price) {
        found.push({
          field: `variant-compare-at-${index}`,
          message: `The compare-at price for ${index + 1} must be higher than the price, or it is not a markdown.`,
        });
      }
    }
  });

  const skus = draft.variants.map((variant) => variant.sku.trim()).filter(Boolean);
  if (new Set(skus).size !== skus.length) {
    found.push({ field: "variants", message: "Two prices use the same SKU." });
  }

  draft.options.forEach((option, index) => {
    const name = option.name.trim() || `Option ${index + 1}`;

    if (option.name.trim() === "") {
      found.push({ field: `option-${index}`, message: `Option ${index + 1} needs a name, like "Size."` });
    }
    if (option.values.length === 0) {
      found.push({ field: `option-${index}`, message: `"${name}" needs at least one value.` });
    }

    option.values.forEach((value, vIndex) => {
      if (value.text.trim() === "") {
        found.push({ field: `option-${index}-${vIndex}`, message: `A value on "${name}" is empty.` });
      }
    });

    const texts = option.values.map((v) => v.text.trim()).filter(Boolean);
    if (new Set(texts).size !== texts.length) {
      found.push({ field: `option-${index}`, message: `Two values on "${name}" are the same.` });
    }
  });

  if (draft.taxCode.trim() !== "" && !TAX_CODE_PATTERN.test(draft.taxCode.trim())) {
    found.push({
      field: "taxCode",
      message: "A Stripe tax code looks like txcd_99999999. Leave it blank to use the store default.",
    });
  }

  // Only worth checking once the pieces above are individually sane — a
  // half-typed axis would otherwise also report a bogus duplicate.
  if (found.length === 0) {
    const input = toInput(draft);

    if (!optionSelectionsAreWellFormed(input.options, input.variants)) {
      found.push({ field: "variants", message: "Every price needs exactly one value chosen for each option." });
    }

    const duplicate = findDuplicateCombination(input.variants);
    if (duplicate) {
      found.push({
        field: "variants",
        message:
          duplicate.length > 0
            ? `Two prices are both "${duplicate.join(" / ")}." Combinations must be unique.`
            : "A product with no options can only have one price.",
      });
    }
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

  const [draft, hydrateDraft] = useState<Draft>(EMPTY_DRAFT);
  /*
   * Whether anyone has edited this form yet.
   *
   * `problems(draft)` is right that an untouched new product is invalid — it
   * has no name, no address and no price — but listing that in red before the
   * merchant has typed a character reads as a broken page rather than as
   * guidance. Every user edit goes through `setDraft` below; the load effect
   * uses `hydrateDraft` directly, so opening an existing product does not
   * count as touching it.
   */
  const [touched, setTouched] = useState(false);

  const setDraft: typeof hydrateDraft = (value) => {
    setTouched(true);
    hydrateDraft(value);
  };

  const [productId, setProductId] = useState<string | null>(null);
  const [images, setImages] = useState<Image[]>([]);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [bulkPriceText, setBulkPriceText] = useState("");
  const hydrated = useRef(false);

  const currency = settings.data?.currency ?? "USD";
  const locale = useStoreLocale();
  // Only nag about weights when some rate would actually read them.
  const weighted =
    shipping.data?.rates.some((r) => r.minWeightGrams !== null || r.maxWeightGrams !== null) ??
    false;

  /* --- load ------------------------------------------------------------- */

  useEffect(() => {
    if (isNew || !loaded.data || hydrated.current) return;

    const product = loaded.data;
    hydrated.current = true;

    const options: DraftOption[] = product.options.map((option) => ({
      key: nextKey(),
      id: option.id,
      name: option.name,
      values: option.values.map((text) => ({ key: nextKey(), text })),
    }));

    setProductId(product.id);
    setImages(product.images);
    hydrateDraft({
      slug: product.slug,
      name: product.name,
      kind: product.kind,
      description: product.description,
      bulletPoints: product.bulletPoints,
      seoTitle: product.seoTitle ?? "",
      seoDescription: product.seoDescription ?? "",
      taxCode: product.taxCode ?? "",
      options,
      variants: product.variants.map((variant) => {
        const selections: Record<string, string> = {};
        options.forEach((option, index) => {
          const text = variant.optionValues[index];
          const match = option.values.find((v) => v.text === text);
          if (match) selections[option.key] = match.key;
        });

        return {
          key: nextKey(),
          id: variant.id,
          selections,
          priceText: (variant.priceCents / 100).toFixed(2),
          sku: variant.sku ?? "",
          compareAtText:
            variant.compareAtPriceCents === null ? "" : (variant.compareAtPriceCents / 100).toFixed(2),
          infinite: variant.inventory.type === "infinite",
          quantity: variant.inventory.type === "finite" ? variant.inventory.quantity : 0,
          weightGrams: variant.weightGrams,
          stripePriceId: variant.stripePriceId,
        };
      }),
      optionGroups: product.optionGroups,
      isLive: product.isLive,
    });
  }, [isNew, loaded.data]);

  /*
   * Titled from the load state, not the draft.
   *
   * On a URL with no product behind it the draft is still empty, so the tab
   * read "New product · Beluga" over a page saying there is no product at this
   * address — the one case where the fallback is exactly wrong.
   */
  useEffect(() => {
    if (!isNew && loaded.isPending) document.title = "Loading… · Beluga";
    else if (!isNew && loaded.isError) document.title = "Product not found · Beluga";
    else document.title = `${draft.name || "New product"} · Beluga`;
  }, [draft.name, isNew, loaded.isPending, loaded.isError]);

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

  /** Apply a change to the options list, regenerating the matrix from it. */
  const applyOptions = (nextOptions: DraftOption[]) =>
    setDraft((current) => ({
      ...current,
      options: nextOptions,
      variants: regenerateVariants(nextOptions, current.variants),
    }));

  /**
   * Same, but for a change that can delete existing rows (removing an axis or
   * a value): warn first when any of the rows about to disappear have stock
   * or a Stripe price attached.
   */
  const applyOptionsWithWarning = (nextOptions: DraftOption[]) => {
    const nextVariants = regenerateVariants(nextOptions, draft.variants);
    const survivingKeys = new Set(nextVariants.map((v) => v.key));
    const dropped = draft.variants.filter((v) => !survivingKeys.has(v.key) && hasStockOrSales(v));

    if (dropped.length === 0) {
      applyOptions(nextOptions);
      return;
    }

    modal.confirm({
      title: `Remove ${dropped.length} price${dropped.length === 1 ? "" : "s"}?`,
      okText: "Remove",
      okButtonProps: { danger: true },
      content:
        "These have stock or a Stripe price already attached. Removing them here cannot be undone once saved.",
      onOk: () => applyOptions(nextOptions),
    });
  };

  const addOption = () => {
    if (draft.options.length >= 3) return;
    applyOptions([...draft.options, { key: nextKey(), name: "", values: [{ key: nextKey(), text: "" }] }]);
  };

  const removeOption = (optionKey: string) =>
    applyOptionsWithWarning(draft.options.filter((o) => o.key !== optionKey));

  const renameOption = (optionKey: string, name: string) =>
    applyOptions(draft.options.map((o) => (o.key === optionKey ? { ...o, name } : o)));

  const addValue = (optionKey: string) =>
    applyOptions(
      draft.options.map((o) =>
        o.key === optionKey ? { ...o, values: [...o.values, { key: nextKey(), text: "" }] } : o,
      ),
    );

  const removeValue = (optionKey: string, valueKey: string) =>
    applyOptionsWithWarning(
      draft.options.map((o) =>
        o.key === optionKey ? { ...o, values: o.values.filter((v) => v.key !== valueKey) } : o,
      ),
    );

  const renameValue = (optionKey: string, valueKey: string, text: string) =>
    applyOptions(
      draft.options.map((o) =>
        o.key === optionKey
          ? { ...o, values: o.values.map((v) => (v.key === valueKey ? { ...v, text } : v)) }
          : o,
      ),
    );

  const applyBulkPrice = () => {
    const cents = parseCents(bulkPriceText);
    if (cents === null || cents < 0) return;
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((variant) => ({ ...variant, priceText: bulkPriceText })),
    }));
  };

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
          // A publish failure is consequential enough that a three-second toast
          // is the wrong register — see the Alert under the header below, which
          // stays on screen until the next attempt.
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
  const showBulkPrice = draft.options.length > 0 && draft.variants.length > 1;

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

      {publish.isError ? (
        <Alert
          className={cx(styles.alert)}
          type="error"
          showIcon
          title="Could not publish to Stripe"
          description={
            publish.error instanceof Error ? publish.error.message : "Something went wrong."
          }
        />
      ) : null}

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

      {/*
        * Only once the form has been touched, or a save has been attempted.
        * The same rule the autosave indicator already follows — it says
        * "Saves automatically" until there is something to save, not
        * "Waiting for the details below" at a form nobody has filled in.
        */}
      {issues.length > 0 && (touched || autosave.state === "error") ? (
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
              label="Type"
              help={
                draft.kind === "digital"
                  ? "Downloads are not posted, so this product is left out of shipping entirely and its stock is unlimited."
                  : "Physical products are weighed, priced for postage, and need a delivery address."
              }
            >
              {() => (
                <Radio.Group
                  value={draft.kind}
                  onChange={(event) => {
                    const kind = event.target.value as ProductKind;
                    setDraft((current) => ({
                      ...current,
                      kind,
                      /*
                       * Switching to digital forces every row to unlimited
                       * rather than leaving a combination the server will
                       * reject — see the refinement on `productInputSchema`.
                       * Doing it here means the merchant sees the consequence
                       * as they make the choice, instead of meeting a
                       * validation error on save with no obvious cause.
                       */
                      variants:
                        kind === "digital"
                          ? current.variants.map((variant) => ({ ...variant, infinite: true }))
                          : current.variants,
                    }));
                  }}
                  options={[
                    { label: "Physical", value: "physical" },
                    { label: "Digital", value: "digital" },
                  ]}
                  optionType="button"
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

          <Card title="Options" className={cx(styles.card)}>
            <p className={cx(styles.cardIntro)}>
              Axes a shopper picks between, like Size or Colour — up to three. Adding a value fills
              the price matrix below with new rows; removing one removes the rows it was in.
            </p>

            {/* The axis name and its values were four identical inputs stacked
                in one box with identical delete buttons and no labels, so
                nothing said the first row is "Size" and the rest are "Small"
                and "Large". Labelled the way the card below already labels
                its own fields. */}
            {draft.options.map((option, index) => (
              <div key={option.key} className={cx(styles.optionGroup)}>
                <Field label="Option name" help="What the shopper is choosing between.">
                  {(control) => (
                    <div className={cx(styles.row)}>
                      <Input
                        {...control}
                        value={option.name}
                        placeholder="Size"
                        onChange={(event) => renameOption(option.key, event.target.value)}
                      />
                      <Button
                        icon={<DeleteOutlined />}
                        aria-label={`Remove option ${option.name.trim() || index + 1}`}
                        onClick={() => removeOption(option.key)}
                      />
                    </div>
                  )}
                </Field>

                <p className={cx(styles.valuesLabel)} id={`option-values-${option.key}`}>
                  Values{option.name.trim() ? ` of ${option.name.trim()}` : ""}
                </p>
                <ul
                  className={cx(styles.optionValues)}
                  aria-labelledby={`option-values-${option.key}`}
                >
                  {option.values.map((value, vIndex) => (
                    <li key={value.key} className={cx(styles.row)}>
                      <Input
                        value={value.text}
                        placeholder="Large"
                        aria-label={`${option.name.trim() || "Option"} value ${vIndex + 1}`}
                        onChange={(event) => renameValue(option.key, value.key, event.target.value)}
                      />
                      <Button
                        icon={<DeleteOutlined />}
                        aria-label={`Remove ${value.text.trim() || `value ${vIndex + 1}`} from ${option.name.trim() || "this option"}`}
                        onClick={() => removeValue(option.key, value.key)}
                      />
                    </li>
                  ))}
                </ul>

                <Button icon={<PlusOutlined />} onClick={() => addValue(option.key)}>
                  Add a value
                </Button>
              </div>
            ))}

            {draft.options.length < 3 ? (
              <Button icon={<PlusOutlined />} onClick={addOption}>
                Add an option
              </Button>
            ) : null}
          </Card>

          <Card title="Prices and stock" className={cx(styles.card)}>
            <p className={cx(styles.cardIntro)}>
              {draft.options.length === 0
                ? "This product has one price."
                : "One row per combination your options generate."}
            </p>

            {showBulkPrice ? (
              <div className={cx(styles.row, styles.bulkPrice)}>
                <Input
                  value={bulkPriceText}
                  inputMode="decimal"
                  prefix={currency}
                  placeholder="19.99"
                  aria-label="Price to apply to every row"
                  onChange={(event) => setBulkPriceText(event.target.value)}
                />
                <Button onClick={applyBulkPrice} disabled={parseCents(bulkPriceText) === null}>
                  Apply to all
                </Button>
              </div>
            ) : null}

            <ul className={cx(styles.variants)}>
              {draft.variants.map((variant, index) => {
                const cents = variantCents(variant);

                return (
                  <li key={variant.key} className={cx(styles.variant)}>
                    {draft.options.length > 0 ? (
                      <span className={cx(styles.comboLabel)}>{comboLabel(draft.options, variant)}</span>
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
                                  : `${formatMoney(cents, currency, locale)} — stored as ${cents} cents`,
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

                    <div className={cx(styles.variantField)}>
                      <Field label="SKU" help="Shown on orders and exports. Optional.">
                        {(control) => (
                          <Input
                            {...control}
                            value={variant.sku}
                            placeholder="TOTE-BLU-S"
                            onChange={(event) => setVariant(variant.key, { sku: event.target.value })}
                          />
                        )}
                      </Field>
                    </div>

                    <div className={cx(styles.variantField)}>
                      <Field
                        label="Compare-at price"
                        error={issues.find((issue) => issue.field === `variant-compare-at-${index}`)?.message}
                        help="Shown struck through, with a Sale badge. Leave blank for no sale."
                      >
                        {(control) => (
                          <Input
                            {...control}
                            value={variant.compareAtText}
                            inputMode="decimal"
                            prefix={currency}
                            placeholder="24.99"
                            onChange={(event) =>
                              setVariant(variant.key, { compareAtText: event.target.value })
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
                        // A download cannot run out, and letting the merchant
                        // say otherwise would flag paid orders as `oversold`
                        // for a file — so the choice is removed, not just
                        // refused on save.
                        disabled={draft.kind === "digital"}
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
                          aria-label={`Quantity in stock for row ${index + 1}`}
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
                            // See SettingsPage: `addonAfter` is deprecated, and
                            // a unit belongs inside the field, not beside it.
                            suffix="g"
                            value={variant.weightGrams}
                            onChange={(value) =>
                              setVariant(variant.key, { weightGrams: value ?? 0 })
                            }
                          />
                        )}
                      </Field>
                    </div>
                  </li>
                );
              })}
            </ul>
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

          {settings.data?.taxEnabled ? (
            <Card title="Tax" className={cx(styles.card)}>
              <p className={cx(styles.help)}>
                Stripe Tax uses the code to decide what rate applies where. Most physical
                goods want the store default; a few categories — books, food, clothing in
                some states — are taxed differently.
              </p>

              <Field
                label="Tax code"
                error={issues.find((issue) => issue.field === "taxCode")?.message}
                help={
                  <>
                    Blank uses the store default,{" "}
                    <code>{settings.data.defaultTaxCode}</code>. Codes are listed in
                    Stripe&rsquo;s tax-code reference.
                  </>
                }
              >
                {(control) => (
                  <Input
                    {...control}
                    value={draft.taxCode}
                    placeholder={settings.data?.defaultTaxCode}
                    onChange={(event) => set("taxCode", event.target.value.trim())}
                  />
                )}
              </Field>

              <p className={cx(styles.help)}>
                Changing this takes effect when the product is published again.
              </p>
            </Card>
          ) : null}

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
            <ImageManager
              productId={productId}
              images={images}
              onChange={setImages}
              variants={draft.variants
                .filter((variant): variant is DraftVariant & { id: string } => Boolean(variant.id))
                .map((variant) => ({ id: variant.id, label: comboLabel(draft.options, variant) }))}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
