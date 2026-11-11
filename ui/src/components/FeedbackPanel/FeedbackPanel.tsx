import { useState } from 'react';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import MailOutlineIcon from '@mui/icons-material/EmailOutlined';
import { sendFeedbackOpened } from '../../api/chatApi';
import { buildFeedbackCopy, buildFeedbackMailto, copyText, openMailto } from '../../feedback/mailto';
import { type ClientConfig, type FeedbackInput, isoWithOffset, ref8, type Reason, REASONS } from '../../feedback/types';
import type { Message } from '../../types';
import './FeedbackPanel.css';

// "Send feedback" under a finished answer. One click on a type, an optional comment, then the user's own
// email app opens with a filled-in plain-text message, ready to send. When no email app opens, Copy email text puts the
// same email on the clipboard for any mail (Outlook on the web too). The app itself sends nothing; it only counts that
// feedback was opened, by type (never the comment, question or answer).
type Assistant = Extract<Message, { role: 'assistant' }>;
export const MAX_COMMENT = 300;

export function feedbackInput(m: Assistant, config: ClientConfig, chatId: string, reason: Reason | null, comment: string): FeedbackInput | null {
  const traceId = m.traceId ?? m.result?.traceId ?? m.failure?.reference;
  if (!traceId || !config.feedback.to) return null;
  return {
    to: config.feedback.to,
    reason,
    comment,
    question: m.question,
    answer: m.result?.answer || m.text || m.failure?.detail || m.error || undefined,
    content: config.feedback.content,
    traceId,
    userRef: config.userRef,
    chatId,
    turn: m.turn ?? 1,
    time: isoWithOffset(new Date(m.endedAt ?? Date.now())),
    build: config.build,
    contract: config.contract,
    genieIds: (m.result?.sources ?? []).filter((s) => s.conversationId && s.messageId).map((s) => `${s.conversationId}/${s.messageId}`),
  };
}

export default function FeedbackPanel({ message, config, chatId }: { message: Assistant; config: ClientConfig | null; chatId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason | null>(null);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState<FeedbackInput | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  if (!config?.feedback.to || message.pending) return null;
  const input = feedbackInput(message, config, chatId, reason, comment);
  if (!input) return null;

  const send = () => {
    openMailto(buildFeedbackMailto(input, config.feedback.maxUrlChars).url);
    void sendFeedbackOpened({ traceId: input.traceId, turn: input.turn, reason: reason ?? 'other' });
    setSent(input);
    setCopied(null);
    setOpen(false);
  };
  const copy = async () => {
    if (sent) setCopied(await copyText(buildFeedbackCopy(sent).body));
  };
  const copyFor = sent ? buildFeedbackCopy(sent) : null;

  return (
    <div className="fb">
      <ButtonBase className="fb__toggle" onClick={() => { setOpen((o) => !o); setSent(null); }} aria-expanded={open}>
        <MailOutlineIcon fontSize="inherit" aria-hidden /> Send feedback
      </ButtonBase>
      {open && (
        <div className="fb__panel" role="group" aria-label="Send feedback">
          <div className="fb__label" id={`fb-types-${message.id}`}>What was wrong?</div>
          <div className="fb__chips" role="group" aria-labelledby={`fb-types-${message.id}`}>
            {REASONS.map((r) => (
              <ButtonBase
                key={r.id}
                className={`fb__chip${reason === r.id ? ' fb__chip--on' : ''}`}
                aria-pressed={reason === r.id}
                onClick={() => setReason((current) => (current === r.id ? null : r.id))}
              >
                {r.label}
              </ButtonBase>
            ))}
          </div>
          <input
            className="fb__comment"
            type="text"
            placeholder="Add a comment (optional)"
            aria-label="Add a comment (optional)"
            maxLength={MAX_COMMENT}
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
          />
          <div className="fb__actions">
            <Button className="fb__send" variant="contained" disableElevation onClick={send}>
              Send email feedback
            </Button>
            <ButtonBase className="fb__cancel" onClick={() => setOpen(false)}>Cancel</ButtonBase>
          </div>
        </div>
      )}
      {copyFor && (
        <div className="fb__notice" role="status">
          {copied === true ? (
            <>Copied. Paste it into a new email to <strong>{copyFor.to.join(', ')}</strong> with the subject <strong>{copyFor.subject}</strong>.</>
          ) : copied === false ? (
            <>Copying is blocked here. Write to <strong>{copyFor.to.join(', ')}</strong> and quote ref <strong>{ref8(sent!.traceId)}</strong>.</>
          ) : (
            <>Your email app is opening with the feedback filled in: check it and press Send. Did it not open?{' '}
              <ButtonBase className="fb__copy" onClick={() => void copy()}>Copy email text</ButtonBase></>
          )}
        </div>
      )}
    </div>
  );
}
