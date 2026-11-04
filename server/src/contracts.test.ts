import { describe, expect, it } from 'vitest';
import { ChatRequestSchema, FeedbackRequestSchema } from './contracts';

describe('ChatRequestSchema', () => {
  it('accepts a question and trims it', () => {
    expect(ChatRequestSchema.parse({ threadId: ' t1 ', message: '  How many placements?  ' })).toEqual({ threadId: 't1', message: 'How many placements?' });
  });

  it('rejects a missing, blank or oversized message', () => {
    expect(ChatRequestSchema.safeParse({ threadId: 't1' }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ threadId: 't1', message: '   ' }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ threadId: 't1', message: 'x'.repeat(4001) }).success).toBe(false);
    expect(ChatRequestSchema.safeParse(undefined).success).toBe(false); // a body that was not JSON
  });
});

describe('FeedbackRequestSchema', () => {
  const ok = { spaceId: 's', conversationId: 'c', messageId: 'm', rating: 'POSITIVE' };

  it('accepts a rating for a message', () => {
    expect(FeedbackRequestSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects an unknown rating or a missing id', () => {
    expect(FeedbackRequestSchema.safeParse({ ...ok, rating: 'GREAT' }).success).toBe(false);
    expect(FeedbackRequestSchema.safeParse({ ...ok, messageId: '' }).success).toBe(false);
  });
});
