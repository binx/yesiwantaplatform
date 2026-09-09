import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  Skeleton,
  Space,
  Switch,
  Tooltip,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type { PageInput } from "@shared/api";
import { RESERVED_PAGE_SLUGS, type PageDraft } from "@shared/schema";
import { cx } from "@/lib/cx";
import {
  useCreatePage,
  useDeletePage,
  usePages,
  useReorderPages,
  useUpdatePage,
} from "./queries";
import { Field } from "./Field";
import { PageHeader } from "./RequireAdmin";
import { SaveIndicator } from "./SaveIndicator";
import { useAutosave } from "./useAutosave";
import { MarkdownEditor } from "./MarkdownEditor";
import styles from "./PagesPage.module.css";

/**
 * Store pages — returns policy, shipping information, contact terms.
 *
 * Before this there was one page of prose in the whole product: `aboutText`,
 * a column on the settings row. A merchant could not publish the refund and
 * contact terms that several consumer-protection regimes, and Stripe's own
 * account requirements, expect a shop to have.
 *
 * Bodies are Markdown. Deliberately not a rich-text editor: what a merchant
 * writes is what is stored, and the storefront renders it through one
 * sanitiser on every read rather than trusting whatever a widget produced.
 */
export function PagesPage() {
  const { modal, message } = App.useApp();

  const pages = usePages();
  const remove = useDeletePage();
  const reorder = useReorderPages();

  useEffect(() => {
    document.title = "Pages · Beluga";
  }, []);

  const all = pages.data ?? [];

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= all.length) return;

    const ids = all.map((page) => page.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(target, 0, moved);

    reorder.mutate(ids, {
      onError: (error: unknown) =>
        void message.error(error instanceof Error ? error.message : "Could not reorder."),
    });
  };

  const confirmDelete = (page: PageDraft) => {
    modal.confirm({
      title: `Delete “${page.title}”?`,
      okText: "Delete",
      okButtonProps: { danger: true },
      content: page.isLive
        ? `It is published at /${page.slug}, so anyone holding that link will get a "not found" instead.`
        : "It is a draft, so nobody is linking to it yet.",
      onOk: () =>
        remove.mutateAsync(page.id).then(
          () => void message.success(`Deleted “${page.title}”.`),
          (error: unknown) => {
            message.error(error instanceof Error ? error.message : "Could not delete.");
            throw error;
          },
        ),
    });
  };

  if (pages.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <PageHeader
        title="Pages"
        description="Prose the shop needs but the catalogue doesn't hold — returns, shipping, contact, terms."
        actions={
          <Link to="/admin/pages/new">
            <Button type="primary" icon={<PlusOutlined />}>
              New page
            </Button>
          </Link>
        }
      />

      {all.length === 0 ? (
        <Empty description="No pages yet">
          <Link to="/admin/pages/new">
            <Button type="primary">Write one</Button>
          </Link>
        </Empty>
      ) : (
        <div className={cx(styles.list)}>
          {all.map((page, index) => (
            <Card
              key={page.id}
              className={cx(styles.card)}
              title={<Link to={`/admin/pages/${page.id}`}>{page.title}</Link>}
              extra={
                <Space>
                  <Space.Compact>
                    <Tooltip title="Move up">
                      <Button
                        icon={<ArrowUpOutlined />}
                        aria-label={`Move ${page.title} up`}
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => move(index, -1)}
                      />
                    </Tooltip>
                    <Tooltip title="Move down">
                      <Button
                        icon={<ArrowDownOutlined />}
                        aria-label={`Move ${page.title} down`}
                        disabled={index === all.length - 1 || reorder.isPending}
                        onClick={() => move(index, 1)}
                      />
                    </Tooltip>
                  </Space.Compact>
                  <Button
                    icon={<DeleteOutlined />}
                    aria-label={`Delete ${page.title}`}
                    danger
                    type="text"
                    onClick={() => confirmDelete(page)}
                  />
                </Space>
              }
            >
              <p className={cx(styles.meta)}>
                <code>/{page.slug}</code>
                <span className={cx(styles.badge, !page.isLive && styles.badgeDraft)}>
                  {page.isLive ? "Published" : "Draft"}
                </span>
                {page.inNav ? <span className={cx(styles.badge)}>In the menu</span> : null}
              </p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ editor */

interface Draft {
  slug: string;
  title: string;
  body: string;
  isLive: boolean;
  inNav: boolean;
}

const EMPTY_DRAFT: Draft = { slug: "", title: "", body: "", isLive: false, inNav: false };

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Everything the API would reject, said before the save is attempted. */
function slugProblem(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug)) {
    return "The web address must be lowercase words separated by hyphens.";
  }

  const owner = RESERVED_PAGE_SLUGS[slug];
  // The same rule the API enforces, phrased the same way — see
  // `pageInputSchema` in shared/api.ts, which is where it actually binds.
  if (owner) return `/${slug} is already ${owner}. Choose a different address.`;

  return null;
}

export function PageEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const isNew = id === undefined;
  const pages = usePages();
  const create = useCreatePage();
  const update = useUpdatePage();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pageId, setPageId] = useState<string | null>(id ?? null);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const hydrated = useRef(false);

  const loaded = pages.data?.find((page) => page.id === id);

  /* --- load ------------------------------------------------------------- */

  useEffect(() => {
    if (isNew || !loaded || hydrated.current) return;
    hydrated.current = true;

    setDraft({
      slug: loaded.slug,
      title: loaded.title,
      body: loaded.body,
      isLive: loaded.isLive,
      inNav: loaded.inNav,
    });
  }, [isNew, loaded]);

  useEffect(() => {
    document.title = `${draft.title || "New page"} · Beluga`;
  }, [draft.title]);

  /* --- autosave ---------------------------------------------------------- */

  const problem = useMemo(
    () => (draft.title.trim() === "" ? "A page needs a title." : slugProblem(draft.slug)),
    [draft.title, draft.slug],
  );
  const valid = problem === null;

  const save = useCallback(
    async (value: Draft) => {
      const input: PageInput = {
        slug: value.slug,
        title: value.title.trim(),
        body: value.body,
        isLive: value.isLive,
        inNav: value.inNav,
      };

      if (pageId) {
        await update.mutateAsync({ id: pageId, input });
        return;
      }

      const created = await create.mutateAsync(input);
      setPageId(created.id);
      // Replaced rather than pushed: the "new" URL is a step nobody wants to
      // go back to, and going back to it would start a second page.
      void navigate(`/admin/pages/${created.id}`, { replace: true });
    },
    [pageId, create, update, navigate],
  );

  const autosave = useAutosave({ value: draft, enabled: valid, save });
  const { markSaved, flush } = autosave;

  // Adopt the loaded page as the baseline on the render that applies it, not
  // in the effect that sets it — see the same note in ProductEditorPage.
  const baselined = useRef(false);

  useEffect(() => {
    if (!hydrated.current || baselined.current) return;
    baselined.current = true;
    markSaved();
  }, [draft, markSaved]);

  // Write out whatever is pending when the editor is navigated away from.
  useEffect(() => () => void flush(), [flush]);

  if (!isNew && pages.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (!isNew && !loaded && !hydrated.current) {
    return (
      <Alert
        type="error"
        showIcon
        message="That page does not exist."
        action={
          <Link to="/admin/pages">
            <Button size="small">Back to pages</Button>
          </Link>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={draft.title || "New page"}
        description={<SaveIndicator autosave={autosave} valid={valid} />}
        actions={
          <Space>
            {draft.isLive && SLUG_PATTERN.test(draft.slug) ? (
              <a href={`/${draft.slug}`} target="_blank" rel="noreferrer">
                <Button>View page</Button>
              </a>
            ) : null}
            <Link to="/admin/pages">
              <Button>Done</Button>
            </Link>
          </Space>
        }
      />

      {autosave.state === "error" && autosave.error ? (
        <Alert
          className={cx(styles.alert)}
          type="error"
          showIcon
          message="This page has not been saved."
          description={autosave.error.message}
        />
      ) : null}

      <div className={cx(styles.editor)}>
        <Field label="Title">
          {(control) => (
            <Input
              {...control}
              value={draft.title}
              autoFocus={isNew}
              placeholder="Returns and refunds"
              onChange={(event) => {
                const title = event.target.value;
                setDraft((current) => ({
                  ...current,
                  title,
                  // Only until the address has been edited by hand: changing it
                  // on a published page breaks every link anyone has saved.
                  ...(slugTouched ? {} : { slug: slugify(title) }),
                }));
              }}
            />
          )}
        </Field>

        <Field
          label="Web address"
          {...(problem && problem !== "A page needs a title." ? { error: problem } : {})}
          help={
            <>
              The page will be at <code>/{draft.slug || "…"}</code>
            </>
          }
        >
          {(control) => (
            <Input
              {...control}
              value={draft.slug}
              // `prefix`, not the deprecated `addonBefore` — the same choice
              // the product editor makes, and it keeps the path and the slug in
              // one box rather than two.
              prefix={<span className={cx(styles.slugPrefix)}>/</span>}
              onChange={(event) => {
                setSlugTouched(true);
                setDraft((current) => ({ ...current, slug: event.target.value }));
              }}
              onBlur={(event) => setDraft((current) => ({ ...current, slug: slugify(event.target.value) }))}
            />
          )}
        </Field>

        <Field
          label="Body"
          help="Markdown: # for a heading, * for a bullet, [text](https://…) for a link."
        >
          {(control) => (
            <MarkdownEditor
              control={control}
              value={draft.body}
              onChange={(body) => setDraft((current) => ({ ...current, body }))}
              placeholder={"## How to return something\n\nEmail us within 30 days…"}
            />
          )}
        </Field>

        <div className={cx(styles.toggles)}>
          <label className={cx(styles.toggle)}>
            <Switch
              checked={draft.isLive}
              onChange={(isLive) => setDraft((current) => ({ ...current, isLive }))}
            />
            <span>
              <strong>Published</strong>
              <em>A draft is visible here and nowhere else.</em>
            </span>
          </label>

          <label className={cx(styles.toggle)}>
            <Switch
              checked={draft.inNav}
              onChange={(inNav) => setDraft((current) => ({ ...current, inNav }))}
              disabled={!draft.isLive}
            />
            <span>
              <strong>Link it in the menu</strong>
              <em>Adds it to the storefront header, after the collections.</em>
            </span>
          </label>
        </div>
      </div>
    </>
  );
}
