import { useState } from "react";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import ThumbUpOffAltIcon from "@mui/icons-material/ThumbUpOffAlt";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import ThumbDownOffAltIcon from "@mui/icons-material/ThumbDownOffAlt";
import { sendFeedback } from "../../api/chatApi";
import type { Source } from "../../types";
import "./ResponseActions.css";

type Rating = "POSITIVE" | "NEGATIVE";

export default function ResponseActions({ sources }: { sources: Source[] }) {
  const [showSql, setShowSql] = useState(false);
  const [rating, setRating] = useState<Rating | null>(null);
  const [failed, setFailed] = useState(false);
  const withSql = sources.filter((s) => s.sql);
  const last = sources[sources.length - 1];
  if (!withSql.length && !last) return null;

  const rate = async (r: Rating) => {
    if (!last || rating) return;
    setRating(r);
    setFailed(false);
    try {
      await sendFeedback({
        spaceId: last.spaceId,
        conversationId: last.conversationId,
        messageId: last.messageId,
        rating: r,
      });
    } catch {
      setRating(null);
      setFailed(true);
    }
  };

  return (
    <>
      <div className="actions">
        {withSql.length > 0 && (
          <Button
            className="actions__btn"
            onClick={() => setShowSql((s) => !s)}
            disableElevation
          >
            ‹/› {showSql ? "Hide generated SQL" : "Show generated SQL"}
          </Button>
        )}
        {last && (
          <span className="actions__rate">
            {failed && (
              <span className="actions__error">Couldn’t send feedback</span>
            )}
            <IconButton
              className="actions__icon"
              size="small"
              disabled={rating !== null}
              onClick={() => rate("POSITIVE")}
              aria-label="Good answer"
            >
              {rating === "POSITIVE" ? (
                <ThumbUpIcon fontSize="inherit" />
              ) : (
                <ThumbUpOffAltIcon fontSize="inherit" />
              )}
            </IconButton>
            <IconButton
              className="actions__icon"
              size="small"
              disabled={rating !== null}
              onClick={() => rate("NEGATIVE")}
              aria-label="Bad answer"
            >
              {rating === "NEGATIVE" ? (
                <ThumbDownIcon fontSize="inherit" />
              ) : (
                <ThumbDownOffAltIcon fontSize="inherit" />
              )}
            </IconButton>
          </span>
        )}
      </div>
      {showSql &&
        withSql.map((s) => (
          <div key={s.messageId} className="sql">
            {withSql.length > 1 && (
              <div className="sql__src">{`${s.spaceName} · ${s.question}`}</div>
            )}
            <pre className="sql__code">{s.sql}</pre>
          </div>
        ))}
    </>
  );
}
