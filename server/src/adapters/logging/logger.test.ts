import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

const capture = (settings: Partial<Parameters<typeof createLogger>[0]> = {}) => {
  const lines: string[] = [];
  const log = createLogger({ format: 'json', level: 'info', content: false, ...settings }, {}, (l) => lines.push(l));
  return { log, lines, json: () => lines.map((l) => JSON.parse(l)) };
};

describe('createLogger', () => {
  it('writes one JSON object per event with the event, level and the fields of its parents', () => {
    const { log, json } = capture();
    log.child({ traceId: 't-1' }).info('chat.turn', { durationMs: 1200, inputTokens: 900 });
    expect(json()[0]).toMatchObject({ level: 'info', message: 'chat.turn', event: 'chat.turn', service: 'conversational-bi', traceId: 't-1', durationMs: 1200, inputTokens: 900 });
  });

  it('never writes a secret, by field name or by shape', () => {
    const { log, lines } = capture();
    const pat = `dapi${'a1'.repeat(16)}`;
    const jwt = `eyJ${'a'.repeat(12)}.eyJ${'b'.repeat(12)}.${'c'.repeat(12)}`;
    log.warn('genie.failed', {
      userToken: 'okta-access-token', sessionId: 's-1', headers: { authorization: 'Bearer abc', cookie: 'bi_session=x' },
      error: new Error(`401 for ${pat} with Bearer ${jwt}`), detail: `key sk-${'x'.repeat(30)}`,
    });
    for (const secret of ['okta-access-token', 's-1', 'abc', 'bi_session=x', pat, jwt, `sk-${'x'.repeat(30)}`]) expect(lines[0]).not.toContain(secret);
    expect(lines[0]).toContain('[redacted]');
  });

  it('leaves out question and answer text unless content logging is on', () => {
    const off = capture();
    off.log.info('chat.turn', { question: 'What is the limit?', sql: 'SELECT 1' });
    expect(off.json()[0]).toMatchObject({ question: '[omitted]', sql: '[omitted]' });
    const on = capture({ content: true });
    on.log.info('chat.turn', { question: 'What is the limit?' });
    expect(on.json()[0].question).toBe('What is the limit?');
  });

  it('skips events below the level and writes readable lines in pretty format', () => {
    const { log, lines } = capture({ level: 'warn', format: 'pretty' });
    log.info('quiet');
    log.warn('genie.retry', { attempt: 2 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d WARN  genie.retry attempt=2$/);
  });
});
