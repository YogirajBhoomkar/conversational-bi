import { useEffect, useRef, useState } from "react";
import ChatHeader from "../../components/ChatHeader/ChatHeader";
import Composer from "../../components/Composer/Composer";
import EmptyState from "../../components/EmptyState/EmptyState";
import AssistantMessage from "../../components/Message/AssistantMessage";
import UserMessage from "../../components/Message/UserMessage";
import { useAuthGuard } from "../../hooks/useAuthGuard";
import { useChat } from "../../hooks/useChat";
import "./ChatPage.css";

export default function ChatPage() {
  useAuthGuard();
  const { messages, busy, send, retry, newChat } = useChat();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToEnd = useRef(true);

  // The page itself scrolls (the composer is sticky). Keep the newest content in view,
  // unless the person has scrolled up to read.
  useEffect(() => {
    if (stickToEnd.current)
      window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [messages]);

  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      stickToEnd.current =
        el.scrollHeight - window.scrollY - window.innerHeight < 120;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Give the input back to the person once the answer is in.
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    stickToEnd.current = true;
    void send(text);
  };

  // A reply to the assistant's question (a choice, or the person's own words) is sent straight away.
  const answer = (text: string) => {
    if (busy) return;
    stickToEnd.current = true;
    void send(text);
  };

  // A suggested follow-up fills the input, as in the mock-up; the person sends it.
  const pick = (q: string) => {
    setDraft(q);
    inputRef.current?.focus();
  };

  const startNew = () => {
    newChat();
    setDraft("");
  };

  return (
    <section className="chat-page">
      <ChatHeader onNewChat={startNew} disabled={busy} />
      <div className="chat-page__body">
        <div className="chat-page__col">
          <div className="chat-page__thread">
            <div className="chat-page__inner">
              {messages.length === 0 && <EmptyState />}
              {messages.map((m, i) => {
                if (m.role === "user") return <UserMessage key={m.id} text={m.text} />;
                const next = messages[i + 1];
                return (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    onPickSuggestion={pick}
                    onAnswer={answer}
                    onRetry={() => {
                      stickToEnd.current = true;
                      retry(m.id);
                    }}
                    answerable={!busy && i === messages.length - 1}
                    answered={next?.role === "user" ? next.text : undefined}
                  />
                );
              })}
            </div>
          </div>
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={submit}
            busy={busy}
            inputRef={inputRef}
          />
        </div>
      </div>
    </section>
  );
}
