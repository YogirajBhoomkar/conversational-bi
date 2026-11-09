import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ErrorNotice from './ErrorNotice';

const unavailable = { kind: 'unavailable' as const, title: "Couldn't reach the AI service", detail: 'Please try again in a minute.', retryable: true, reference: 'ref-123' };

describe('ErrorNotice', () => {
  it('shows the title, what to do, a Try again button and the reference', () => {
    const html = renderToStaticMarkup(<ErrorNotice failure={unavailable} onRetry={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Couldn&#x27;t reach the AI service');
    expect(html).toContain('Please try again in a minute.');
    expect(html).toContain('Try again');
    expect(html).toContain('<code>ref-123</code>');
  });

  it('offers no Try again when it would not help, or on an older turn', () => {
    expect(renderToStaticMarkup(<ErrorNotice failure={{ ...unavailable, retryable: false }} onRetry={() => undefined} />)).not.toContain('Try again');
    expect(renderToStaticMarkup(<ErrorNotice failure={unavailable} />)).not.toContain('Try again');
  });

  it('works with an older server that sends only the message', () => {
    const html = renderToStaticMarkup(<ErrorNotice failure={{ detail: 'Something went wrong while answering. If it happens again, quote reference x.' }} />);
    expect(html).toContain('Something went wrong');
    expect(html).toContain('quote reference x.');
    expect(html).not.toContain('Reference <code>');
  });
});
