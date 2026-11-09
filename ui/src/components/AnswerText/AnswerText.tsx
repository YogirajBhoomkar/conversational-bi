import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeComponents, safeMarkdown } from '../../markdown/safeMarkdown';
import './AnswerText.css';

export default function AnswerText({ children }: { children: string }) {
  return (
    <div className="answer-text">
      <ReactMarkdown remarkPlugins={[remarkGfm]} {...safeMarkdown} components={safeComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
