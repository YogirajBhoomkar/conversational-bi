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
  const { messages, busy, send, newChat } = useChat();
  console.log("messages", messages);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);

  // Keep the newest content in view, unless the person has scrolled up to read.
  useEffect(() => {
    const el = threadRef.current;
    if (el && stickToEnd.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Give the input back to the person once the answer is in.
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const onScroll = () => {
    const el = threadRef.current;
    if (el)
      stickToEnd.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
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
          <div
            className="chat-page__thread"
            ref={threadRef}
            onScroll={onScroll}
          >
            <div className="chat-page__inner">
              {messages.length === 0 && <EmptyState />}
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserMessage key={m.id} text={m.text} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    onPickSuggestion={pick}
                  />
                ),
              )}
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
