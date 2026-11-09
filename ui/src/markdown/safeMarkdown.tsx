// What the chat renders from model text, in the answer and in the scratchpad. Text hidden in the data could make the
// model write an image or a link whose URL carries data out: an image loads by itself, a link on a click. So nothing
// that points outside is rendered: no images, no raw HTML, and links show only their text. The server removes these
// too (core/guards/output.ts), but streamed text is shown before the server can correct it.
import type { Components, Options } from 'react-markdown';

export const safeMarkdown: Pick<Options, 'skipHtml' | 'disallowedElements' | 'unwrapDisallowed'> = {
  skipHtml: true,
  disallowedElements: ['img'],
  unwrapDisallowed: false,
};

export const safeComponents: Components = {
  a: ({ children }) => <span className="md-link">{children}</span>,
};
