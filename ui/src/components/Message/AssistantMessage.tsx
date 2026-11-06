import type { Message } from "../../types";
import AnswerText from "../AnswerText/AnswerText";
import ChartCard from "../ChartCard/ChartCard";
import Clarification from "../Clarification/Clarification";
import DataTableCard from "../DataTableCard/DataTableCard";
import GenieIcon from "../GenieIcon/GenieIcon";
import ResponseActions from "../ResponseActions/ResponseActions";
import SuggestionChips from "../SuggestionChips/SuggestionChips";
import TraceView from "../TraceView/TraceView";
import "./Message.css";

type Assistant = Extract<Message, { role: "assistant" }>;

export default function AssistantMessage({
  message: m,
  onPickSuggestion,
  onAnswer,
  answerable,
  answered,
}: {
  message: Assistant;
  onPickSuggestion: (q: string) => void;
  onAnswer: (text: string) => void; // sends the user's reply to a question back (a clarification)
  answerable: boolean;              // this is the latest answer and nothing is running
  answered?: string;                // what the user replied next, if they did
}) {
  const r = m.result;
  // Genie's own follow-ups win; otherwise the ones the supervisor model wrote (they can arrive before or after `final`).
  const followUps = r?.suggestedQuestions.length
    ? r.suggestedQuestions
    : (m.suggestions ?? []);

  return (
    <div className="msg">
      <div className="msg__avatar">
        <GenieIcon size={18} />
      </div>
      <div className="msg__body">
        <div className="msg__who">Genie</div>
        <TraceView
          trace={m.trace}
          pending={m.pending}
          startedAt={m.startedAt}
          endedAt={m.endedAt}
        />
        {m.text && <AnswerText>{m.text}</AnswerText>}
        {m.error && <div className="msg__error">{m.error}</div>}
        {r && (
          <>
            {r.charts
              .filter((c) => c.data.length > 0)
              .map((c, i) => (
                <ChartCard key={`${i}-${c.title}`} spec={c} />
              ))}
            {r.columns.length > 0 && (
              <DataTableCard
                columns={r.columns}
                rows={r.rows}
                totalRows={r.totalRows}
              />
            )}
            {r.clarification && (
              <Clarification
                question={r.clarification.question}
                options={r.clarification.options}
                active={answerable}
                chosen={answered}
                onAnswer={onAnswer}
              />
            )}
            {/* <ResponseActions sources={r.sources} /> */}
            {!r.clarification && <SuggestionChips questions={followUps} onPick={onPickSuggestion} />}
          </>
        )}
      </div>
    </div>
  );
}
