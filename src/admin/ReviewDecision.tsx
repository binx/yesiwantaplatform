import { useState } from "react";
import { App, Button, Input, Popconfirm } from "antd";
import { useReviewArtist, useReviewEdition } from "./queries";

interface ReviewDecisionProps {
  kind: "artist" | "edition";
  id: string;
  /** The page's or the edition's name, for the confirmation. */
  name: string;
  /** Approving is refused by the server until the artist's page is; the button says so instead of failing. */
  blocked?: string;
  onDecided?: () => void;
}

/**
 * The admin's yes or no on a page or an edition, with a word to the artist
 * on a no. Approving is one click; declining opens the note first, because
 * "no" with nothing said leaves the artist guessing.
 */
export function ReviewDecision({ kind, id, name, blocked, onDecided }: ReviewDecisionProps) {
  const { message } = App.useApp();
  const reviewArtist = useReviewArtist();
  const reviewEdition = useReviewEdition();
  const review = kind === "artist" ? reviewArtist : reviewEdition;
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");

  const decide = (decision: "approved" | "declined", done: string) =>
    review.mutate(
      { id, input: { decision, note: note.trim() } },
      {
        onSuccess: () => {
          message.success(done);
          setDeclining(false);
          setNote("");
          onDecided?.();
        },
        onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not record that."),
      },
    );

  if (declining) {
    return (
      <div style={{ display: "grid", gap: "0.5rem", maxWidth: "32rem" }}>
        <label htmlFor={`decline-note-${id}`}>A note for the artist</label>
        <Input.TextArea id={`decline-note-${id}`} value={note} autoSize={{ minRows: 3 }} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button danger type="primary" loading={review.isPending} onClick={() => decide("declined", `${name} declined.`)}>
            Decline
          </Button>
          <Button onClick={() => setDeclining(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
      <Popconfirm title={`Approve ${name}?`} okText="Approve" onConfirm={() => decide("approved", `${name} approved.`)} disabled={Boolean(blocked)}>
        <Button type="primary" loading={review.isPending} disabled={Boolean(blocked)}>
          Approve
        </Button>
      </Popconfirm>
      <Button onClick={() => setDeclining(true)}>Decline</Button>
      {blocked ? <span style={{ color: "#b45309" }}>{blocked}</span> : null}
    </div>
  );
}
