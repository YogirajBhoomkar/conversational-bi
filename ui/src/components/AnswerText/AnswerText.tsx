import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './AnswerText.css';

export default function AnswerText({ children }: { children: string }) {
  return (
    <div className="answer-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
