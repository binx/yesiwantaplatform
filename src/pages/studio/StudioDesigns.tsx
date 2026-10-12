import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Popconfirm, Skeleton } from "antd";
import type { EditionStudio } from "@shared/platform";
import type { PostcardDesign } from "@shared/postcards";
import { DesignForm } from "@/components/postcard/DesignForm";
import { ProductImage } from "@/components/ui/ProductImage";
import { useDeleteDesign, useStudioDesigns, useStudioEditions } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { formatDay } from "@/lib/postcards";
import postcard from "@/components/postcard/Postcard.module.css";
import styles from "./Studio.module.css";

/**
 * The artist's postcards, and where each one is used.
 *
 * Designs are made once and put into editions afterwards, so the library and
 * the editor share these pieces: the designer, the drawer of what has been
 * made, and the picker a card slot opens.
 */

interface DesignUse {
  /** Titles of the editions the design is in. */
  editions: string[];
  /** In an edition past draft: collectors paid for it as it is, so it can't change. */
  locked: boolean;
}

/** Which editions each design is in. A design in none is free to change or delete. */
function useDesignUses(): Map<string, DesignUse> {
  const editions = useStudioEditions();
  return useMemo(() => designUses(editions.data ?? []), [editions.data]);
}

function designUses(editions: EditionStudio[]): Map<string, DesignUse> {
  const uses = new Map<string, DesignUse>();
  for (const edition of editions) {
    for (const card of edition.cards) {
      const use = uses.get(card.design.id) ?? { editions: [], locked: false };
      use.editions.push(edition.title);
      if (edition.status !== "draft") use.locked = true;
      uses.set(card.design.id, use);
    }
  }
  return uses;
}

/** "In Flowers and Birds", or nothing. */
function usedIn(use: DesignUse | undefined): string | null {
  if (!use || use.editions.length === 0) return null;
  const titles = use.editions;
  return `In ${titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`}`;
}

/**
 * Make a postcard, and the drawer of every postcard made.
 *
 * Editing a card's note reuses the designer above, in its editing mode; a
 * card in an edition on sale has neither edit nor delete, because the
 * server would refuse both.
 */
export function DesignLibrary({ artistName }: { artistName: string }) {
  const store = useStore();
  const designs = useStudioDesigns();
  const uses = useDesignUses();
  const { message } = App.useApp();
  const [editing, setEditing] = useState<PostcardDesign | null>(null);
  const formRef = useRef<HTMLElement>(null);

  const edit = (design: PostcardDesign) => {
    setEditing(design);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <section ref={formRef} className={styles.panel} aria-labelledby="design-heading">
        <h2 id="design-heading">{editing ? "Change a postcard's note" : "Make a postcard"}</h2>
        <DesignForm
          artistName={artistName}
          editing={editing}
          onSaved={() => void message.success("Saved. Put it in an edition whenever you like.")}
          onEdited={() => setEditing(null)}
          onCancelEdit={() => setEditing(null)}
        />
      </section>

      <section aria-labelledby="drawer-heading">
        <h2 id="drawer-heading">Your postcards</h2>
        {designs.isPending ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : (designs.data ?? []).length === 0 ? (
          <p className={styles.empty}>None yet. Make one above, then put it in an edition.</p>
        ) : (
          <ul className={postcard.designGrid}>
            {(designs.data ?? []).map((design) => (
              <DrawerCard key={design.id} design={design} use={uses.get(design.id)} locale={store.locale} onEdit={() => edit(design)} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function DrawerCard({ design, use, locale, onEdit }: { design: PostcardDesign; use: DesignUse | undefined; locale: string; onEdit: () => void }) {
  const remove = useDeleteDesign();
  const { message } = App.useApp();
  const where = usedIn(use);
  const made = formatDay(design.createdAt, locale);

  return (
    <li className={postcard.designCard}>
      <ProductImage image={design.thumbnail} sizes="200px" decorative />
      <p className={styles.note}>
        Made {made}
        {where ? <span className={styles.designUse}>{where}</span> : null}
      </p>
      {use?.locked ? (
        <p className={styles.help}>In an edition on sale, so it stays as it is.</p>
      ) : (
        <div className={styles.inline}>
          <Button size="small" onClick={onEdit} aria-label={`Change the note on the postcard made ${made}`}>
            Change the note
          </Button>
          {where ? null : (
            <Popconfirm
              title="Delete this postcard?"
              onConfirm={() => remove.mutate(design.id, { onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not delete it.") })}
            >
              <Button size="small" type="text" danger loading={remove.isPending} aria-label={`Delete the postcard made ${made}`}>
                Delete
              </Button>
            </Popconfirm>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Choose a postcard for one card of an edition: one already made, or a new
 * one made here and used straight away.
 *
 * Inline rather than a dialog, like the rest of the studio. Focus moves to
 * its heading when it opens, so a keyboard user lands where the choice is.
 */
export function DesignPicker({
  heading,
  artistName,
  exclude,
  onPick,
  onCancel,
}: {
  heading: string;
  artistName: string;
  /** Designs already in this edition: each can be in it once. */
  exclude: ReadonlySet<string>;
  onPick: (design: PostcardDesign) => void;
  onCancel: () => void;
}) {
  const store = useStore();
  const designs = useStudioDesigns();
  const uses = useDesignUses();
  const [making, setMaking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const available = (designs.data ?? []).filter((design) => !exclude.has(design.id));

  useEffect(() => headingRef.current?.focus(), [heading]);

  return (
    <section className={styles.panel} aria-labelledby="picker-heading">
      <h3 id="picker-heading" ref={headingRef} tabIndex={-1} className={styles.pickerHeading}>
        {heading}
      </h3>
      {making ? (
        <DesignForm artistName={artistName} onSaved={onPick} />
      ) : designs.isPending ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : available.length === 0 ? (
        <p className={styles.empty}>{(designs.data ?? []).length === 0 ? "You haven't made a postcard yet." : "Every postcard you've made is already in this edition."}</p>
      ) : (
        <ul className={postcard.designGrid}>
          {available.map((design, index) => {
            const where = usedIn(uses.get(design.id));
            return (
              <li key={design.id}>
                <button type="button" className={styles.pickButton} onClick={() => onPick(design)}>
                  <ProductImage image={design.thumbnail} sizes="200px" decorative />
                  <span className={styles.pickLabel}>Use postcard {index + 1}</span>
                  <span className={styles.note}>
                    Made {formatDay(design.createdAt, store.locale)}
                    {where ? <span className={styles.designUse}>{where}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.actions}>
        <Button onClick={() => setMaking((value) => !value)}>{making ? "Choose one already made" : "Make a new postcard"}</Button>
        <Button type="text" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
