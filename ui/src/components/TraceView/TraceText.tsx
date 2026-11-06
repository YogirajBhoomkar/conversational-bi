import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { asList } from './listify';

// A scratchpad text (a plan, a question to a data source, a thought) with its structure shown: paragraphs, lists,
// bold, and inline numbered parts as a list. Compact, to sit inside the scratchpad.
export default function TraceText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`trace__md ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{asList(text)}</ReactMarkdown>
    </div>
  );
}
