import { Link } from "react-router-dom";
import { Button } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import styles from "./NotFoundPage.module.css";

export function NotFoundPage() {
  return (
    <PageWrapper>
      <div className={styles.page}>
        {/*
          Decorative: "Not found" below already says this to a screen reader.

          `data-decorative-text` is the contrast suite's exemption marker — see
          e2e/accessibility.spec.ts. WCAG 1.4.3 exempts text that is pure
          decoration, which this watermark is: it carries no information the
          <h1> under it does not, and axe cannot infer that on its own. Put the
          attribute on nothing that a reader has to make out.
        */}
        <div className={styles.mark} aria-hidden data-decorative-text>
          404
        </div>
        <h1 className={styles.title}>Not found</h1>
        <p className={styles.text}>
          That page doesn't exist.
        </p>
        <Link to="/">
          <Button type="primary">Back home</Button>
        </Link>
      </div>
    </PageWrapper>
  );
}
