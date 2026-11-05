import type { GenieProgress, TraceItem } from '../../contracts';
import type { SpaceRegistry } from '../genie/registry';

// Turns the supervisor's stream into the scratchpad the UI shows, keeping only what tells the user something:
// - the supervisor's plan (the text it writes before handing over),
// - one entry per data source it asks (label: the source's name, text: the question),
// - under each source, Genie's short thoughts and each query it runs (updated in place when the query finishes).
// The data agents' own notes repeat the plan, and their Ask Genie calls repeat the source entry, so neither is shown.
// The text of a supervisor step that calls no tool is the final answer. Names come from the space registry.
type Sink = {
  trace: (item: TraceItem) => void;
  answer: (delta: string) => void;
};

const HANDOVER = 'agent-genie_';

// The parts of a Mastra stream chunk the tracer reads. Mastra puts them under `payload`; older chunks have them at the top.
type Payload = {
  text?: string;
  textDelta?: string;
  toolName?: string;
  toolCallId?: string;
  args?: { prompt?: unknown; question?: unknown; query?: unknown };
  result?: { error?: unknown };
  stepResult?: { reason?: string };
  output?: { type?: string; payload?: Payload };
};
export type TraceChunk = Payload & { type: string; payload?: Payload };

const clip = (s: unknown, max = 300) => {
  const text = String(s ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// A thought as one short line: its first sentence, cut at a word when that is still long.
const THOUGHT_MAX = 140;
export const crisp = (s: string) => {
  const text = s.replace(/\s+/g, ' ').trim();
  const first = /^.+?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
  if (first.length <= THOUGHT_MAX) return first;
  const cut = first.slice(0, THOUGHT_MAX - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 60 ? cut.lastIndexOf(' ') : cut.length)}…`;
};

const describeTool = (toolName: string, spaceName: (key: string) => string): string =>
  toolName.startsWith(HANDOVER) ? spaceName(toolName.slice(HANDOVER.length)) : toolName.replace(/^agent-/, '').replace(/[-_]+/g, ' ');

// What was sent to the tool or agent, shown under its entry.
const detailOf = (args: Payload['args']) => clip(args?.prompt ?? args?.question ?? args?.query);

export function createTracer(sink: Sink, registry: SpaceRegistry) {
  const spaceName = (key: string) => registry.byKey(key)?.name ?? key;
  let n = 0;
  const nextId = (prefix: string) => `${prefix}${++n}`;
  const sourceOf = new Map<string, string>(); // space key -> the source entry its progress belongs to
  let latestSource: string | undefined;
  let plan = '';                              // the supervisor's text of its current step
  const lastThought = new Map<string, string>(); // per source, to drop a thought that repeats the previous one

  const supervisor = (type: string, p: Payload | undefined) => {
    switch (type) {
      case 'text-delta':
        plan += p?.text ?? p?.textDelta ?? '';
        break;
      case 'tool-call-input-streaming-start':
      case 'tool-call': {
        // Text written before a tool call is the plan, not the answer.
        const note = clip(plan, 600);
        plan = '';
        if (note) sink.trace({ id: nextId('note'), kind: 'note', text: note });
        const toolName = String(p?.toolName ?? '');
        const detail = type === 'tool-call' ? detailOf(p?.args) : '';
        if (toolName.startsWith(HANDOVER) && p?.toolCallId) {
          sourceOf.set(toolName.slice(HANDOVER.length), p.toolCallId);
          latestSource = p.toolCallId;
        }
        sink.trace({ id: String(p?.toolCallId), kind: 'tool', label: describeTool(toolName, spaceName), status: 'running', ...(detail ? { text: detail } : {}) });
        break;
      }
      case 'tool-result': {
        const error = typeof p?.result?.error === 'string' ? p.result.error : '';
        sink.trace({ id: String(p?.toolCallId), kind: 'tool', label: describeTool(String(p?.toolName ?? ''), spaceName), status: error ? 'error' : 'done', ...(error ? { text: clip(error) } : {}) });
        break;
      }
      case 'step-finish':
        // A step that called no tool is the final answer.
        if (p?.stepResult?.reason !== 'tool-calls' && plan) sink.answer(plan);
        plan = '';
        break;
    }
  };

  // Inside a handover only the data agent's tool calls matter: loading all rows, and errors from Genie.
  const specialist = (source: string, type: string, p: Payload | undefined) => {
    const error = type === 'tool-result' && typeof p?.result?.error === 'string' ? clip(p.result.error, 200) : '';
    if (String(p?.toolName ?? '').startsWith('fetch-full-') && (type === 'tool-call' || type === 'tool-result')) {
      const status = type === 'tool-call' ? 'running' : error ? 'error' : 'done';
      sink.trace({ id: `${source}:${p?.toolCallId}`, kind: 'progress', step: 'query', parent: source, text: error || 'Loading all rows', status });
    } else if (error) {
      sink.trace({ id: nextId('progress'), kind: 'progress', step: 'status', parent: source, text: error, status: 'error' });
    }
  };

  return {
    handle(chunk: TraceChunk) {
      const p = chunk?.payload ?? chunk;
      if (chunk?.type === 'tool-output') {
        // The data agent's own stream arrives nested inside the supervisor's handover call.
        const inner = p?.output;
        if (inner?.type) specialist(String(p?.toolCallId), inner.type, inner.payload);
        return;
      }
      supervisor(String(chunk?.type), p);
    },
    // What Genie is doing for a space, shown under that space's source entry.
    progress(event: GenieProgress, spaceKey?: string) {
      const parent = (spaceKey && sourceOf.get(spaceKey)) || latestSource;
      if (event.kind === 'query') {
        const title = event.title ? clip(event.title, 120) : undefined;
        sink.trace({ id: `${parent}:q:${event.id}`, kind: 'progress', step: 'query', parent, status: event.status, ...(title ? { text: title } : {}) });
        return;
      }
      const text = event.kind === 'thought' ? crisp(event.text) : clip(event.text, 140);
      const key = parent ?? '';
      if (!text || lastThought.get(key) === text) return;
      lastThought.set(key, text);
      sink.trace({ id: nextId('progress'), kind: 'progress', step: event.kind, parent, text });
    },
    // Safety net: if the stream ended without a closing step, whatever text is left is the answer.
    end() {
      if (plan) sink.answer(plan);
      plan = '';
    },
  };
}
