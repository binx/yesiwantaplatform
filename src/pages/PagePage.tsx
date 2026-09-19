import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { Skeleton } from "antd";
import { useQuery } from "@tanstack/react-query";
import type { Page } from "@shared/schema";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ApiError, apiGet } from "@/lib/api";
import { NotFoundPage } from "./NotFoundPage";
import styles from "./PagePage.module.css";

/**
 * A merchant-authored page — returns policy, shipping information, contact.
 *
 * Bodies are not in the store snapshot: the banner needs every page's title on
 * first paint, but a shopper looking at a product should not also be
 * downloading ten policies. The summary arrives with the store, the body
 * arrives here.
 */
export function PagePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";

  const page = useQuery({
    // Shares a key prefix with the admin's invalidations, so publishing an edit
    // updates an open storefront tab without a reload.
    queryKey: ["page", slug],
    queryFn: ({ signal }) => apiGet<Page>(`/pages/${slug}`, signal),
    // A page that does not exist is an answer, not a failure to get one.
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

  useEffect(() => {
    if (page.data) document.title = page.data.title;
  }, [page.data]);

  if (page.isPending) {
    return (
      <PageWrapper width="prose">
        <Skeleton active paragraph={{ rows: 8 }} />
      </PageWrapper>
    );
  }

  // A draft page 404s publicly, so an unknown slug and an unpublished one are
  // indistinguishable from outside — which is the point.
  if (page.isError || !page.data) return <NotFoundPage />;

  return (
    <PageWrapper width="prose">
      <h1>{page.data.title}</h1>
      {/*
       * The HTML here was rendered from Markdown and sanitised on the server
       * (see server/markdown.ts) — the allow-list is prose tags and nothing
       * else, and it is applied on every read rather than once at save time.
       * Rendering it any other way would mean shipping a Markdown parser to
       * every shopper.
       */}
      <div className={styles.body} dangerouslySetInnerHTML={{ __html: page.data.bodyHtml }} />
    </PageWrapper>
  );
}
