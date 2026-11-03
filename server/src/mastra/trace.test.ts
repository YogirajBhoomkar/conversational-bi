import { describe, expect, it } from 'vitest';
import type { TraceItem } from '../contracts';
import { createTracer } from './trace';

// Chunk shapes captured from a real supervisor stream.
const top = (type: string, payload: object) => ({ type, payload });
const nested = (outerTool: string, type: string, payload: object) => ({ type: 'tool-output', payload: { toolName: outerTool, toolCallId: 'outer', output: { type, payload } } });
const finish = (reason: string) => ({ stepResult: { reason } });

const run = (chunks: any[], progress: string[] = []) => {
  const trace: TraceItem[] = [];
  let answer = '';
  const t = createTracer({ trace: (i) => trace.push(i), answer: (d) => (answer += d) });
  chunks.forEach((c) => t.handle(c));
  progress.forEach((p) => t.progress(p));
  t.end();
  return { trace, answer };
};

describe('createTracer', () => {
  it('shows the text written before a handover as a working note, not as the answer', () => {
    const { trace, answer } = run([
      top('text-delta', { text: "I'll ask the placement agent " }),
      top('text-delta', { text: 'for the counts.' }),
      top('tool-call-input-streaming-start', { toolCallId: 'c1', toolName: 'agent-genie_placement' }),
      top('tool-call', { toolCallId: 'c1', toolName: 'agent-genie_placement', args: { prompt: 'Count placements by status', maxSteps: 10 } }),
      top('tool-result', { toolCallId: 'c1', toolName: 'agent-genie_placement', result: { text: 'done' } }),
      top('step-finish', finish('tool-calls')),
    ]);
    expect(answer).toBe('');
    expect(trace[0]).toMatchObject({ kind: 'note', text: "I'll ask the placement agent for the counts." });
    expect(trace[1]).toMatchObject({ id: 'c1', kind: 'tool', label: 'Hand over to Lab – Placement Core', status: 'running' });
    expect(trace[2]).toMatchObject({ id: 'c1', text: 'Count placements by status' });
    expect(trace[3]).toMatchObject({ id: 'c1', status: 'done' });
  });

  it('treats the text of a step that calls no tool as the final answer', () => {
    const { trace, answer } = run([top('text-delta', { text: 'Hello. ' }), top('text-delta', { text: 'Ask me about placements.' }), top('step-finish', finish('stop'))]);
    expect(answer).toBe('Hello. Ask me about placements.');
    expect(trace).toEqual([]);
  });

  it("shows the data agent's note and its question to Genie, and drops its closing report", () => {
    const { trace, answer } = run([
      nested('agent-genie_placement', 'text-delta', { text: 'I will count placements by status.' }),
      nested('agent-genie_placement', 'tool-call-input-streaming-start', { toolCallId: 'a1', toolName: 'ask-placement' }),
      nested('agent-genie_placement', 'tool-call', { toolCallId: 'a1', toolName: 'ask-placement', args: { question: 'Count placements by status for 2026.' } }),
      nested('agent-genie_placement', 'tool-result', { toolCallId: 'a1', toolName: 'ask-placement', result: { summary: 's', error: null } }),
      nested('agent-genie_placement', 'step-finish', finish('tool-calls')),
      nested('agent-genie_placement', 'text-delta', { text: 'Internal report for the supervisor.' }),
      nested('agent-genie_placement', 'step-finish', finish('stop')),
    ]);
    expect(answer).toBe('');
    expect(trace[0]).toMatchObject({ kind: 'note', by: 'Lab – Placement Core', text: 'I will count placements by status.' });
    expect(trace[1]).toMatchObject({ id: 'a1', label: 'Ask Genie', by: 'Lab – Placement Core', status: 'running' });
    expect(trace[2]).toMatchObject({ id: 'a1', text: 'Count placements by status for 2026.' });
    expect(trace[3]).toMatchObject({ id: 'a1', status: 'done' });
    expect(trace.some((i) => i.text?.includes('Internal report'))).toBe(false);
  });

  it("puts Genie's progress under the Ask Genie entry that is running", () => {
    const { trace } = run(
      [nested('agent-genie_capacity', 'tool-call-input-streaming-start', { toolCallId: 'a9', toolName: 'ask-capacity' })],
      ['Running query: unused capacity', 'Query finished, reading the results…'],
    );
    const progress = trace.filter((i) => i.kind === 'progress');
    expect(progress.map((i) => i.text)).toEqual(['Running query: unused capacity', 'Query finished, reading the results…']);
    expect(progress.every((i) => i.parent === 'a9')).toBe(true);
  });

  it('marks an Ask Genie entry as failed when Genie reports an error', () => {
    const { trace } = run([nested('agent-genie_placement', 'tool-result', { toolCallId: 'a2', toolName: 'ask-placement', result: { error: 'Genie timed out' } })]);
    expect(trace[0]).toMatchObject({ id: 'a2', status: 'error', text: 'Genie timed out' });
  });

  it('names unknown tools without any special wording', () => {
    const { trace } = run([top('tool-call-input-streaming-start', { toolCallId: 'x', toolName: 'web_search-tool' })]);
    expect(trace[0]).toMatchObject({ label: 'web search tool', status: 'running' });
  });

  it('keeps leftover text as the answer when the stream ends without a closing step', () => {
    expect(run([top('text-delta', { text: 'Done.' })]).answer).toBe('Done.');
  });
});
