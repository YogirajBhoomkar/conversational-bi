import { useState, type FormEvent } from 'react';
import ButtonBase from '@mui/material/ButtonBase';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import EditIcon from '@mui/icons-material/EditOutlined';
import './Clarification.css';

// The assistant needs the user to choose before it can answer: the likely answers as numbered choices, and a last
// choice to type one's own. Choosing sends the answer straight away. Once answered (or when a newer turn exists) the
// choices stay visible but can no longer be used, and the chosen one is marked.
export default function Clarification({ question, options, active, chosen, onAnswer }: {
  question: string;
  options: string[];
  active: boolean;
  chosen?: string;
  onAnswer: (text: string) => void;
}) {
  const [typing, setTyping] = useState(false);
  const [own, setOwn] = useState('');

  const submitOwn = (e: FormEvent) => {
    e.preventDefault();
    if (own.trim()) onAnswer(own.trim());
  };

  return (
    <div className={`clarify${active ? '' : ' is-closed'}`}>
      <p className="clarify__question">{question}</p>
      <ol className="clarify__options">
        {options.map((option, i) => (
          <li key={option}>
            <ButtonBase className={`clarify__option${chosen === option ? ' is-chosen' : ''}`} disabled={!active} onClick={() => onAnswer(option)}>
              <span className="clarify__num">{i + 1}</span>
              <span className="clarify__label">{option}</span>
              {active && <ArrowForwardIcon className="clarify__go" />}
            </ButtonBase>
          </li>
        ))}
        <li>
          {typing && active ? (
            <form className="clarify__own" onSubmit={submitOwn}>
              <input autoFocus value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Type your answer…" aria-label="Your own answer" />
              <ButtonBase type="submit" className="clarify__send" disabled={!own.trim()}>
                Send
              </ButtonBase>
            </form>
          ) : (
            <ButtonBase
              className={`clarify__option clarify__option--own${chosen && !options.includes(chosen) ? ' is-chosen' : ''}`}
              disabled={!active}
              onClick={() => setTyping(true)}
            >
              <EditIcon className="clarify__num clarify__num--icon" />
              <span className="clarify__label">{chosen && !options.includes(chosen) ? chosen : 'Something else…'}</span>
            </ButtonBase>
          )}
        </li>
      </ol>
    </div>
  );
}
