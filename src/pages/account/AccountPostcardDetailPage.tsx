import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { App, Button, Popconfirm, Result, Skeleton } from "antd";
import { summariseDesign } from "@shared/gallery";
import { ProductImage } from "@/components/ui/ProductImage";
import { PostcardBackMock } from "@/components/postcard/PostcardBackMock";
import { PostcardSchedule } from "@/components/postcard/PostcardSchedule";
import { useDeleteDraft, useDuplicateDesign, useGalleryDesign } from "@/lib/gallery";
import { formatMailDate } from "@/lib/postcards";
import { assetUrl } from "@/lib/store-source";
import { useStore } from "@/lib/useStore";
import { cx } from "@/lib/cx";
import account from "./Account.module.css";
import styles from "./Gallery.module.css";

/**
 * One design: the front, the back as it printed, every card of it and
 * where each got to, and the one action that matters — send it again.
 */
export function AccountPostcardDetailPage() {
  const { id } = useParams();
  const design = useGalleryDesign(id);
  const duplicate = useDuplicateDesign();
  const remove = useDeleteDraft();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { locale } = useStore();

  useEffect(() => {
    document.title = "Your postcard · Your account";
  }, []);

  if (design.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;

  if (design.error || !design.data) {
    return (
      <Result
        status="404"
        title={<h2>No postcard found</h2>}
        subTitle="This postcard doesn't exist, or isn't on your account."
        extra={
          <Link to="/account/postcards">
            <Button type="primary">Back to your postcards</Button>
          </Link>
        }
      />
    );
  }

  const data = design.data;
  const first = data.postcards.firstMailDate;
  const last = data.postcards.lastMailDate;

  return (
    <div>
      <p>
        <Link to="/account/postcards">← Your postcards</Link>
      </p>

      <div className={styles.detail}>
        <div className={styles.thumb}>
          <ProductImage image={data.thumbnail} sizes="(max-width: 800px) 100vw, 320px" priority decorative />
        </div>
        <div>
          <p className={cx(account.meta)}>
            {summariseDesign(data)}
            {first ? ` · mailed ${last && last !== first ? `${formatMailDate(first, locale)} to ${formatMailDate(last, locale)}` : formatMailDate(first, locale)}` : ""}
          </p>
          <div className={styles.backHolder}>
            <PostcardBackMock back={data.back} />
          </div>
          <div className={styles.actions}>
            {data.canSendAgain ? (
              <Button
                type="primary"
                loading={duplicate.isPending}
                onClick={() =>
                  duplicate.mutate(data.id, {
                    onSuccess: (copy) => void navigate(`/create?designs=${copy.id}`),
                    onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not copy the postcard."),
                  })
                }
              >
                Send again
              </Button>
            ) : (
              <span className={cx(account.meta)}>This one can't be sent again: its print file was removed before you had an account.</span>
            )}
            <a href={assetUrl(data.thumbnail.path)} download>
              <Button>Download</Button>
            </a>
            {!data.ordered ? (
              <Popconfirm
                title="Delete this draft?"
                onConfirm={() => remove.mutate(data.id, { onSuccess: () => void navigate("/account/postcards") })}
              >
                <Button danger loading={remove.isPending}>
                  Delete
                </Button>
              </Popconfirm>
            ) : null}
          </div>
        </div>
      </div>

      {data.cards.length > 0 ? (
        <>
          <h2>Who got it</h2>
          <PostcardSchedule order={{ postcards: data.cards, designs: [data] }} locale={locale} />
        </>
      ) : (
        <p className={cx(account.meta)}>Not sent to anyone yet.</p>
      )}

      {data.copies.length > 0 ? (
        <>
          <h2>Sent again</h2>
          <ul className={styles.copies}>
            {data.copies.map((copy) => (
              <li key={copy.id}>
                <Link to={`/account/postcards/${copy.id}`}>
                  {copy.postcards.firstMailDate ? formatMailDate(copy.postcards.firstMailDate, locale) : new Date(copy.createdAt).toLocaleDateString(locale)}
                </Link>{" "}
                <span className={cx(account.meta)}>{summariseDesign(copy)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
