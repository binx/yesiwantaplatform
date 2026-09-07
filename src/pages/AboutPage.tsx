import { PageWrapper } from "@/components/layout/PageWrapper";
import { useStore } from "@/lib/useStore";
import { NotFoundPage } from "./NotFoundPage";

export function AboutPage() {
  const store = useStore();

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
