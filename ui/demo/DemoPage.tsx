// The main chat page with fewer features: the question, the answer, the data table and the chart data as JSON.
// No scratchpad, no drawn charts, no follow-up suggestions; a question back to the user is shown with its choices.
// Everything visible comes from the main UI's components.
import { useEffect, useRef, useState } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import AnswerText from '../src/components/AnswerText/AnswerText';
import Card from '../src/components/Card/Card';
import Clarification from '../src/components/Clarification/Clarification';
import ChatHeader from '../src/components/ChatHeader/ChatHeader';
import Composer from '../src/components/Composer/Composer';
import DataTableCard from '../src/components/DataTableCard/DataTableCard';
import EmptyState from '../src/components/EmptyState/EmptyState';
import GenieIcon from '../src/components/GenieIcon/GenieIcon';
import UserMessage from '../src/components/Message/UserMessage';
import FeedbackPanel from '../src/components/FeedbackPanel/FeedbackPanel';
import { useClientConfig } from '../src/feedback/useClientConfig';
import type { ClientConfig } from '../src/feedback/types';
import '../src/components/Message/Message.css';
import { useAuthGuard } from '../src/hooks/useAuthGuard';
import { useChat } from '../src/hooks/useChat';
import '../src/pages/ChatPage/ChatPage.css';
import type { Message } from '../src/types';
import './demo.css';

type Assistant = Extract<Message, { role: 'assistant' }>;

function DemoAnswer({ message: m, onAnswer, answerable, answered, chatId, clientConfig }: { message: Assistant; onAnswer: (text: string) => void; answerable: boolean; answered?: string; chatId: string; clientConfig: ClientConfig | null }) {
  const r = m.result;
  const charts = r?.charts ?? [];
  return (
    <div className="msg">
      <div className="msg__avatar">
        <GenieIcon size={18} />
      </div>
      <div className="msg__body">
        <div className="msg__who">Genie</div>
        {m.pending && !m.text && (
          <div className="demo__working">
            <CircularProgress size={14} thickness={6} />
            Working on it…
          </div>
        )}
        {m.text && <AnswerText>{m.text}</AnswerText>}
        {m.error && <div className="msg__error">{m.error}</div>}
        {r && r.columns.length > 0 && <DataTableCard columns={r.columns} rows={r.rows} totalRows={r.totalRows} />}
        {r?.clarification && (
          <Clarification question={r.clarification.question} options={r.clarification.options} active={answerable} chosen={answered} onAnswer={onAnswer} />
        )}
        {r && charts.length > 0 && (
          <Card title="Chart data (JSON)">
            <pre className="demo__json">{JSON.stringify(charts.length === 1 ? charts[0] : charts, null, 2)}</pre>
          </Card>
        )}
        <FeedbackPanel message={m} config={clientConfig} chatId={chatId} />
      </div>
    </div>
  );
}

export default function DemoPage() {
  useAuthGuard();
  const { messages, busy, send, newChat, threadId } = useChat();
  const clientConfig = useClientConfig();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    void send(text);
  };

  return (
    <section className="chat-page">
      <ChatHeader
        onNewChat={() => {
          newChat();
          setDraft('');
        }}
        disabled={busy}
      />
      <div className="chat-page__body">
        <div className="chat-page__col">
          <div className="chat-page__thread">
            <div className="chat-page__inner">
              {messages.length === 0 && <EmptyState />}
              {messages.map((m, i) => {
                if (m.role === 'user') return <UserMessage key={m.id} text={m.text} />;
                const next = messages[i + 1];
                return (
                  <DemoAnswer
                    key={m.id}
                    message={m}
                    onAnswer={(text) => {
                      if (!busy) void send(text);
                    }}
                    answerable={!busy && i === messages.length - 1}
                    answered={next?.role === 'user' ? next.text : undefined}
                    chatId={threadId}
                    clientConfig={clientConfig}
                  />
                );
              })}
            </div>
          </div>
          <Composer value={draft} onChange={setDraft} onSend={submit} busy={busy} inputRef={inputRef} />
        </div>
      </div>
    </section>
  );
}
