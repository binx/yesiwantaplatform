import { Link } from "react-router-dom";
import { Button, Result } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";

export function NotFoundPage() {
  return (
    <PageWrapper>
      <Result
        status="404"
        // antd renders the title in a <div>; a 404 still needs a real heading
        // so the page has a document outline and screen readers announce it.
        title={<h1>Not found</h1>}
        subTitle="That page doesn't exist, or the product is no longer available."
        extra={
          <Link to="/">
            <Button type="primary">Back to the shop</Button>
          </Link>
        }
      />
    </PageWrapper>
  );
}
