import { Link } from "react-router-dom";
import { Button } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import styles from "./NotFoundPage.module.css";

export function NotFoundPage() {
  return (
    <PageWrapper>
      <div className={styles.page}>
        {/* Decorative: "Not found" below already says this to a screen reader. */}
        <div className={styles.mark} aria-hidden>
          404
        </div>
        <h1 className={styles.title}>Not found</h1>
        <p className={styles.text}>
          That page doesn't exist, or the product is no longer available.
        </p>
        <Link to="/">
          <Button type="primary">Back to the shop</Button>
        </Link>
      </div>
    </PageWrapper>
  );
}
