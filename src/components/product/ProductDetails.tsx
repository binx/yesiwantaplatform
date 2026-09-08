import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App as AntApp, Button, InputNumber, Select } from "antd";
import type { Product } from "@shared/schema";
import { formatMoney } from "@shared/money";
import { useCart, normalizeQuantity } from "@/store/cart";
import { cx } from "@/lib/cx";
import styles from "./ProductDetails.module.css";

interface ProductDetailsProps {
  product: Product;
  currency: string;
}

/** The variant holding `value` on axis `axisIndex`, given the other axes already chosen. */
function variantForValue(
  product: Product,
  selections: Record<string, string>,
  axisIndex: number,
  value: string,
) {
  return product.variants.find(
    (variant) =>
      variant.optionValues[axisIndex] === value &&
      product.options.every(
        (option, i) => i === axisIndex || variant.optionValues[i] === selections[option.id],
      ),
  );
}

/** The variant naming exactly this combination, if any. */
function resolveVariant(product: Product, selections: Record<string, string>) {
  return product.variants.find((variant) =>
    product.options.every((option, i) => variant.optionValues[i] === selections[option.id]),
  );
}

export function ProductDetails({ product, currency }: ProductDetailsProps) {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const add = useCart((s) => s.add);

  const [selections, setSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(product.options.map((o) => [o.id, o.values[0] ?? ""])),
  );
  const [quantity, setQuantity] = useState(1);
  const [options, setOptions] = useState<Record<string, string>>(() =>
    Object.fromEntries(product.optionGroups.map((g) => [g.name, g.choices[0] ?? ""])),
  );

  const variant = useMemo(
    () => resolveVariant(product, selections) ?? product.variants[0],
    [product, selections],
  );

  if (!variant) return null;

  const stock = variant.inventory.type === "finite" ? variant.inventory.quantity : null;
  const soldOut = stock === 0;

  const handleAdd = () => {
    const safeQuantity = normalizeQuantity(quantity, stock);
    add({ productId: product.id, variantId: variant.id, quantity: safeQuantity, options });
    message.success(`${product.name} added to your cart.`);
    void navigate("/cart");
  };

  return (
    <div className={styles.details}>
      <h1 className={styles.name}>{product.name}</h1>

      <p className={styles.price}>{formatMoney(variant.priceCents, currency)}</p>

      {product.description && <p className={styles.description}>{product.description}</p>}

      {/*
        One selector per axis. v1 rendered a single picker only when a product
        had more than one variant *group*, so a product whose sole axis was
        size showed no selector at all and silently shipped the first option.
      */}
      {product.options.map((option, axisIndex) => (
        <label key={option.id} className={styles.field}>
          <span className={styles.label}>{option.name}</span>
          <Select<string>
            /*
             * Named explicitly. Wrapping a label around antd's Select does not
             * name it — the control is a div with a readonly combobox inside,
             * and the implicit association never reaches it, so both of these
             * pickers reached the accessibility tree as a bare "combobox".
             * The quantity input beside them was already doing this.
             */
            aria-label={option.name}
            value={selections[option.id] ?? option.values[0] ?? ""}
            onChange={(value) => {
              setSelections((prev) => ({ ...prev, [option.id]: value }));
              // Re-clamp: the new variant may hold less stock than the old one.
              const next = resolveVariant(product, { ...selections, [option.id]: value });
              const nextStock = next?.inventory.type === "finite" ? next.inventory.quantity : null;
              setQuantity((q) => normalizeQuantity(q, nextStock));
            }}
            options={option.values.map((value) => {
              const covering = variantForValue(product, selections, axisIndex, value);
              const soldOutHere =
                covering?.inventory.type === "finite" && covering.inventory.quantity === 0;

              return {
                value,
                label: !covering ? `${value} — unavailable` : soldOutHere ? `${value} — sold out` : value,
                disabled: !covering || soldOutHere,
              };
            })}
            className={cx(styles.control)}
          />
        </label>
      ))}

      {product.optionGroups.map((group) => (
        <label key={group.name} className={styles.field}>
          <span className={styles.label}>{group.name}</span>
          <Select<string>
            aria-label={group.name}
            value={options[group.name] ?? group.choices[0] ?? ""}
            onChange={(value) => setOptions((prev) => ({ ...prev, [group.name]: value }))}
            options={group.choices.map((choice) => ({ value: choice, label: choice }))}
            className={cx(styles.control)}
          />
        </label>
      ))}

      {stock !== null && stock > 0 && stock < 5 && (
        <p className={styles.stock}>Only {stock} left</p>
      )}

      <div className={styles.actions}>
        <label className={styles.quantity}>
          <span className="sr-only">Quantity</span>
          <InputNumber
            min={1}
            {...(stock !== null ? { max: stock } : {})}
            step={1}
            precision={0}
            value={quantity}
            disabled={soldOut}
            // Clamped on change rather than trusting the input's max attribute,
            // which v1 relied on and which does not constrain typed values.
            onChange={(value) => setQuantity(normalizeQuantity(value, stock))}
            aria-label="Quantity"
          />
        </label>

        <Button type="primary" size="large" block disabled={soldOut} onClick={handleAdd}>
          {soldOut ? "Sold out" : "Add to cart"}
        </Button>
      </div>

      {product.bulletPoints.length > 0 && (
        <ul className={styles.bullets}>
          {product.bulletPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
