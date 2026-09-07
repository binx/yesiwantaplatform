import type { ReactNode } from "react";
import styles from "./PageWrapper.module.css";

interface PageWrapperProps {
  children: ReactNode;
  /** `wide` for product grids, `prose` for readable text columns. */
  width?: "default" | "wide" | "prose";
}

export function PageWrapper({ children, width = "default" }: PageWrapperProps) {
  return <div className={`${styles.wrapper} ${styles[width]}`}>{children}</div>;
}
