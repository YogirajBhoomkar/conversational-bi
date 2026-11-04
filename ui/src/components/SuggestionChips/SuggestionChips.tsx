import ButtonBase from "@mui/material/ButtonBase";
import "./SuggestionChips.css";

export default function SuggestionChips({
  questions,
  onPick,
}: {
  questions: string[];
  onPick: (q: string) => void;
}) {
  if (!questions.length) return null;
  return (
    <div className="follow">
      <div className="follow__label">Suggested follow-ups</div>
      {questions.map((q) => (
        <ButtonBase key={q} className="chip" onClick={() => onPick(q)}>
          {q}
        </ButtonBase>
      ))}
    </div>
  );
}
