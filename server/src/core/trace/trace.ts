import type { TraceItem } from '../../contracts';
import type { SpaceRegistry } from '../genie/registry';

// Turns the supervisor's stream into the scratchpad the UI shows: the agents' own working notes (the text they write before
// a tool call or handover), one entry per tool call or handover, and Genie's progress under the call that produced it.
// The text of a step that calls no tool is the final answer. Nothing about the business is written here: names come from the space registry.
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

const describeTool = (toolName: string, spaceName: (key: string) => string): { label: string; by?: string } => {
  if (toolName.startsWith(HANDOVER)) return { label: `Hand over to ${spaceName(toolName.slice(HANDOVER.length))}` };
  const ask = /^ask-(.+)$/.exec(toolName);
  if (ask) return { label: 'Ask Genie', by: spaceName(ask[1]) };
  const full = /^fetch-full-(.+)$/.exec(toolName);
  if (full) return { label: 'Load full result', by: spaceName(full[1]) };
  return { label: toolName.replace(/^agent-/, '').replace(/[-_]+/g, ' ') };
};

// What was sent to the tool or agent, shown under its entry.
const detailOf = (args: Payload['args']) => clip(args?.prompt ?? args?.question ?? args?.query);

export function createTracer(sink: Sink, registry: SpaceRegistry) {
  const spaceName = (key: string) => registry.byKey(key)?.name ?? key;
  let n = 0;
  const nextId = (prefix: string) => `${prefix}${++n}`;
  let currentAsk: string | undefined; // the Ask Genie entry that Genie's progress lines belong to

  // Each level (the supervisor, and the data agent running inside a handover) buffers the text of its current step.
  const levels = { supervisor: { text: '' }, specialist: { text: '' } };
  type Level = keyof typeof levels;

  const flushNote = (level: Level, by?: string) => {
    const text = clip(levels[level].text, 600);
    levels[level].text = '';
    if (text) sink.trace({ id: nextId('note'), kind: 'note', text, by });
  };

  const onChunk = (level: Level, type: string, p: Payload | undefined, by?: string) => {
    switch (type) {
      case 'text-delta':
        levels[level].text += p?.text ?? p?.textDelta ?? '';
        break;
      case 'tool-call-input-streaming-start':
      case 'tool-call': {
        flushNote(level, by); // text written before a tool call is the agent's working note, not the answer
        const toolName = String(p?.toolName ?? '');
        if (level === 'specialist' && toolName.startsWith('ask-')) currentAsk = p?.toolCallId;
        const detail = type === 'tool-call' ? detailOf(p?.args) : '';
        sink.trace({ id: String(p?.toolCallId), kind: 'tool', ...describeTool(toolName, spaceName), status: 'running', ...(detail ? { text: detail } : {}) });
        break;
      }
      case 'tool-result': {
        const error = typeof p?.result?.error === 'string' ? p.result.error : '';
        sink.trace({ id: String(p?.toolCallId), kind: 'tool', ...describeTool(String(p?.toolName ?? ''), spaceName), status: error ? 'error' : 'done', ...(error ? { text: clip(error) } : {}) });
        break;
      }
      case 'step-finish': {
        const calledTools = p?.stepResult?.reason === 'tool-calls';
        // A supervisor step that called no tool is the final answer. A data agent's closing report is internal, so it is dropped.
        if (level === 'supervisor' && !calledTools && levels.supervisor.text) sink.answer(levels.supervisor.text);
        levels[level].text = '';
        break;
      }
    }
  };

  return {
    handle(chunk: TraceChunk) {
      const p = chunk?.payload ?? chunk;
      if (chunk?.type === 'tool-output') {
        // The data agent's own stream arrives nested inside the supervisor's handover call.
        const inner = p?.output;
        const key = String(p?.toolName ?? '').startsWith(HANDOVER) ? spaceName(String(p?.toolName).slice(HANDOVER.length)) : undefined;
        if (inner?.type) onChunk('specialist', inner.type, inner.payload, key);
        return;
      }
      onChunk('supervisor', String(chunk?.type), p);
    },
    // One line of Genie's own progress, shown under the Ask Genie entry that is running.
    progress(text: string) {
      const line = clip(text, 400);
      if (line) sink.trace({ id: nextId('progress'), kind: 'progress', text: line, parent: currentAsk });
    },
    // Safety net: if the stream ended without a closing step, whatever text is left is the answer.
    end() {
      if (levels.supervisor.text) sink.answer(levels.supervisor.text);
      levels.supervisor.text = '';
    },
  };
}
