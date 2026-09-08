import { PageWrapper } from "@/components/layout/PageWrapper";
import { useStore } from "@/lib/useStore";
import { NotFoundPage } from "./NotFoundPage";
import { PagePage } from "./PagePage";

/**
 * `/about`, which predates store pages.
 *
 * Once a page exists at the `about` slug — every migrated store gets one, from
 * whatever `aboutText` held — this route renders it, so saved links and search
 * results keep working and there is only one place to edit the copy. The
 * `aboutText` fallback below is for a store that has not migrated yet; the
 * column is deprecated and goes in the next release.
 */
export function AboutPage() {
  const store = useStore();

  if (store.pages.some((page) => page.slug === "about")) return <PagePage slug="about" />;

  // v1 called `aboutText.split("\n")` on whatever the endpoint returned, so a
  // non-string response white-screened the page.
  if (!store.aboutText) return <NotFoundPage />;

  const paragraphs = store.aboutText.split("\n").filter((line) => line.trim() !== "");

  return (
    <PageWrapper width="prose">
      <h1>About</h1>
      {paragraphs.map((paragraph, i) => (
        <p key={i}>{paragraph}</p>
      ))}
    </PageWrapper>
  );
}
