import { describe, expect, it } from 'vitest';
import type { ChatEvent, GenieResult } from '../../contracts';
import type { Collector } from '../chat/collector';
import { handleChat, type ChatDeps } from '../chat/handleChat';
import { createSpaceRegistry } from '../genie/registry';
import { silentLogger } from '../log';
import { createOutputGuard, NO_DATA_MESSAGE, noDataOverride, redactInternalNames, sanitizeMarkdown } from './output';

const registry = createSpaceRegistry([
  { key: 'placement', name: 'Placement', description: 'd', spaceId: 'id-1' },
  { key: 'capacity', name: 'Capacity', description: 'd', spaceId: 'id-2' },
]);

const result = (over: Partial<GenieResult> = {}): GenieResult => ({
  spaceId: 'id-1', question: 'q', summary: '', sql: null, columns: ['n'], rows: [[42]], totalRows: 1, thinking: [], suggestedQuestions: [],
  statementId: null, conversationId: 'c', messageId: 'm', error: null, ...over,
});

describe('sanitizeMarkdown', () => {
  it('removes images, inline and reference style, with their definitions', () => {
    expect(sanitizeMarkdown('Total **42**. ![x](https://example.invalid/p?d=42)')).toBe('Total **42**. ');
    expect(sanitizeMarkdown('See ![chart][img]\n\n[img]: https://example.invalid/p?d=42')).toBe('See \n\n');
  });

  it('keeps the text of a link and drops its target, and drops bare URLs and autolinks', () => {
    expect(sanitizeMarkdown('Read [the guide](https://example.invalid/x) or [this][ref].')).toBe('Read the guide or this.');
    expect(sanitizeMarkdown('Go to https://example.invalid/leak?d=1 or <https://example.invalid>.')).toBe('Go to  or .');
  });

  it('removes raw HTML and comments', () => {
    expect(sanitizeMarkdown('A <img src="https://example.invalid/p"> B <b>bold</b> <!-- note -->C')).toBe('A  B bold C');
  });

  it('leaves ordinary Markdown alone, indentation and comparisons included', () => {
    const text = '**EMEA** leads.\n\n1. EMEA: 1,737.2M\n   - of which cat: 40%\n2. APAC: 856.1M\n\nLimits < 5M are [rare] and x > y.';
    expect(sanitizeMarkdown(text)).toBe(text);
  });
});

describe('redactInternalNames', () => {
  it('names the data source instead of its agent or tools, and removes the rest; names come from the registry', () => {
    const { text, count } = redactInternalNames('I asked genie_placement and `ask-capacity`, then ask_user_to_choose via bi_supervisor.', registry);
    expect(text).toBe('I asked Placement and Capacity, then via.');
    expect(count).toBe(4);
  });

  it('does not touch words that only contain a name', () => {
    expect(redactInternalNames('genie_placements_total and xgenie_placement', registry)).toEqual({ text: 'genie_placements_total and xgenie_placement', count: 0 });
  });
});

describe('noDataOverride', () => {
  it('replaces figures when every Genie call failed or came back empty', () => {
    expect(noDataOverride('There are 42.', [result({ error: 'down', columns: [], rows: [], totalRows: 0 })])).toBe(NO_DATA_MESSAGE);
    expect(noDataOverride('There are 42.', [result({ columns: [], rows: [], totalRows: 0 })])).toBe(NO_DATA_MESSAGE);
  });

  it('keeps the answer when data came back, as rows or as Genie text with figures', () => {
    expect(noDataOverride('There are 42.', [result({ error: 'down', totalRows: 0 }), result()])).toBe('There are 42.');
    expect(noDataOverride('There are 42.', [result({ columns: [], rows: [], totalRows: 0, summary: 'The count is 42.' })])).toBe('There are 42.');
  });

  it('is not applied to small talk, a question back to the user, or an answer without figures', () => {
    const empty = [result({ error: 'down', totalRows: 0 })];
    expect(noDataOverride('Hi! I answer questions about 2 areas.', [])).toBe('Hi! I answer questions about 2 areas.');
    expect(noDataOverride('Which year, 2023 or 2024?', empty, { question: 'Which year?', options: ['2023', '2024'] })).toBe('Which year, 2023 or 2024?');
    expect(noDataOverride('Genie could not answer that.', empty)).toBe('Genie could not answer that.');
  });
});

// A turn whose model streams `deltas` after a working note, with the given Genie results.
async function turn(deltas: string[], results: GenieResult[], guardOn = true) {
  const deps: ChatDeps = {
    supervisor: { stream: (async (_m: unknown, opts: { requestContext: { get(k: string): unknown } }) => {
      (opts.requestContext.get('collector') as Collector).results.push(...results);
      return { fullStream: (async function* () {
        yield { type: 'text-delta', payload: { text: 'Asking genie_placement, see https://example.invalid/x' } };
        yield { type: 'tool-call', payload: { toolCallId: 'c1', toolName: 'agent-genie_placement', args: { prompt: 'q' } } };
        yield { type: 'tool-result', payload: { toolCallId: 'c1', toolName: 'agent-genie_placement', result: {} } };
        yield { type: 'step-finish', payload: { stepResult: { reason: 'tool-calls' } } };
        for (const text of deltas) yield { type: 'text-delta', payload: { text } };
        yield { type: 'step-finish', payload: { stepResult: { reason: 'stop' } } };
      })() };
    }) as unknown as ChatDeps['supervisor']['stream'] },
    suggestAgent: { generate: (async () => ({ object: { questions: [] } })) as unknown as ChatDeps['suggestAgent']['generate'] },
    registry, modelLabel: 'm', suggestWaitMs: 0, genieMode: 'conversation', logger: silentLogger, turnTimeoutMs: 30_000,
    history: { turns: 3, maxChars: 1500, includeSql: false }, outputGuard: createOutputGuard(guardOn, registry),
  };
  const events: ChatEvent[] = [];
  for await (const e of handleChat(deps, { userId: 'u', userToken: 't', traceId: 'tr', signal: new AbortController().signal }, { threadId: 'a', message: 'q' })) events.push(e);
  return events;
}

describe('output guard on the stream', () => {
  it('corrects an image split across deltas: text-reset, the clean text, then final with it', async () => {
    const events = await turn(['There are **42**. ![p](https://exa', 'mple.invalid/p?d=42)'], [result()]);
    const i = events.findIndex((e) => e.type === 'text-reset' && events.slice(0, events.indexOf(e)).some((x) => x.type === 'text'));
    expect(events.slice(i)).toEqual([
      { type: 'text-reset' },
      { type: 'text', delta: 'There are **42**. ' },
      expect.objectContaining({ type: 'final', result: expect.objectContaining({ answer: 'There are **42**. ' }) }),
    ]);
  });

  it('cleans trace texts before they are sent', async () => {
    const notes = (await turn(['Fine.'], [result()])).flatMap((e) => (e.type === 'trace' && e.item.kind === 'note' ? [e.item.text] : []));
    expect(notes).toContain('Asking Placement, see ');
  });

  it('replaces figures with the no-data message when Genie returned nothing', async () => {
    const events = await turn(['There are 42.'], [result({ error: 'down', columns: [], rows: [], totalRows: 0 })]);
    expect(events.find((e) => e.type === 'final')).toMatchObject({ result: { answer: NO_DATA_MESSAGE } });
  });

  it('changes nothing when BI_GUARD_OUTPUT=off', async () => {
    const events = await turn(['There are 42. ![p](https://example.invalid/p)'], [result()], false);
    expect(events.some((e) => e.type === 'text-reset' && events.indexOf(e) > events.findIndex((x) => x.type === 'text'))).toBe(false);
    expect(events.find((e) => e.type === 'final')).toMatchObject({ result: { answer: 'There are 42. ![p](https://example.invalid/p)' } });
  });
});
