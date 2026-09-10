import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Result, Skeleton } from "antd";
import { stripEmoji } from "@shared/postcards";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductImage } from "@/components/ui/ProductImage";
import { ApiError } from "@/lib/api";
import { fetchReplyCard } from "@/lib/reply";
import { formatMailDate } from "@/lib/postcards";
import { useStore } from "@/lib/useStore";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./ReplyPage.module.css";

/**
 * The page behind the QR on the back of a card.
 *
 * Three things, in increasing cost: see the card online, say it arrived
 * with one tap, and — when the sender has opted in — send one back. Opening
 * this page records nothing about the reader; only the tap does, and only
 * what they chose to say.
 */
export function ReplyPage() {
  const { code = "" } = useParams();
  const store = useStore();
  useDocumentTitle("A postcard for you");

  const card = useQuery({
    queryKey: ["reply-card", code],
    queryFn: ({ signal }) => fetchReplyCard(code, signal),
    enabled: code !== "",
    retry: false,
  });

  if (code === "" || (card.isError && card.error instanceof ApiError && card.error.status === 404)) {
    return (
      <PageWrapper width="prose">
        <Result status="warning" title={<h1>There's no postcard here</h1>} subTitle="Check the code on the card. If it was mailed recently, try again in a few days." extra={<Home />} />
      </PageWrapper>
    );
  }

  if (card.isPending) {
    return (
      <PageWrapper width="prose">
        <Skeleton active paragraph={{ rows: 6 }} />
      </PageWrapper>
    );
  }

  if (card.isError) {
    return (
      <PageWrapper width="prose">
        <Result status="error" title={<h1>That did not work</h1>} subTitle="Try again in a moment." extra={<Home />} />
      </PageWrapper>
    );
  }

  const { front, back, senderName, mailedOn, canReply } = card.data;
  const from = senderName ?? "someone";
  const fontPx = Math.max(16, Math.min(28, back.fontSize));

  return (
    <PageWrapper width="prose">
      <h1>A postcard for you{senderName ? `, from ${senderName}` : ""}</h1>

      <div className={styles.card}>
        <ProductImage image={front} sizes="(max-width: 600px) 100vw, 448px" priority decorative />
      </div>

      <div style={{ fontFamily: `"${back.fontName}", cursive`, fontSize: fontPx, color: back.fontColor }}>
        <p className={styles.message}>{stripEmoji(back.text)}</p>
        {back.valediction ? <p className={styles.valediction}>{stripEmoji(back.valediction)}</p> : null}
      </div>
      <p className={styles.from}>Mailed {formatMailDate(mailedOn, store.locale)}.</p>

      {canReply ? (
        <div className={styles.reply}>
          <h2>Send one back</h2>
          <p>
            Design a postcard and it goes to {from} — their address stays with us, and you never see it.
          </p>
          <Link to={`/create?replyTo=${encodeURIComponent(code)}`}>
            <Button type="primary" size="large">
              Send a postcard back
            </Button>
          </Link>
        </div>
      ) : null}

      <p className={styles.footer}>
        Made with {store.name}. <Link to="/create">Send one to someone</Link>.
      </p>
    </PageWrapper>
  );
}

function Home() {
  return (
    <Link to="/">
      <Button type="primary">Back to the store</Button>
    </Link>
  );
}
