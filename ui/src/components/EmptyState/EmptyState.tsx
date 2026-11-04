import GenieIcon from "../GenieIcon/GenieIcon";
import "./EmptyState.css";

export default function EmptyState() {
  return (
    <div className="empty">
      <div className="empty__icon">
        <GenieIcon size={36} strokeWidth={3} />
      </div>
      <h3 className="empty__title">Conversational BI Assistance</h3>
      <p className="empty__text">
        Ask a question in plain language. Answers appear as text, a table and a
        chart.
      </p>
    </div>
  );
}
