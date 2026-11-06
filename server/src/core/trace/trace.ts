import type { GenieProgress, TraceItem } from '../../contracts';
import { agentName, clarifyToolName, fetchFullToolName } from '../agents/prompts';
import type { SpaceRegistry } from '../genie/registry';

// Turns the supervisor's stream into the scratchpad the UI shows, keeping only what tells the user something:
// - the supervisor's plan (the text it writes before handing over),
// - one entry per data source it asks (label: the source's name, text: the question),
// - under each source, Genie's thoughts (in full) and each query it runs (updated in place when the query finishes).
// The data agents' own notes repeat the plan, and their Ask Genie calls repeat the source entry, so neither is shown.
// The text of a supervisor step that calls no tool is the final answer; all text streams as it is written (see below).
// Names come from the space registry.
type Sink = {
  trace: (item: TraceItem) => void;
  answer: (delta: string) => void;
  retract: () => void; // the answer streamed so far was a plan after all: clear it
};

// Tool names come from the one place that names agents and tools. Mastra names an agent's handover tool agent-<agent name>.
const HANDOVER = `agent-${agentName('')}`;
const FETCH_FULL = fetchFullToolName('');

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

// Everything the user reads is shown in full; only error texts (which can carry a whole HTTP body) are shortened.
// Line breaks are kept (lists and paragraphs in a question or a thought); runs of spaces and blank lines are not.
const tidy = (s: unknown) =>
  String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const clip = (s: unknown, max = 300) => {
  const text = tidy(s).replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const describeTool = (toolName: string, spaceName: (key: string) => string): string =>
  toolName.startsWith(HANDOVER) ? spaceName(toolName.slice(HANDOVER.length)) : toolName.replace(/^agent-/, '').replace(/[-_]+/g, ' ');

// What was sent to the tool or agent, shown under its entry.
const detailOf = (args: Payload['args']) => tidy(args?.prompt ?? args?.question ?? args?.query);

export function createTracer(sink: Sink, registry: SpaceRegistry) {
  const spaceName = (key: string) => registry.byKey(key)?.name ?? key;
  let n = 0;
  const nextId = (prefix: string) => `${prefix}${++n}`;
  const sourceOf = new Map<string, string>(); // space key -> the source entry its progress belongs to
  let latestSource: string | undefined;
  const lastThought = new Map<string, string>(); // per source, to drop a thought that repeats the previous one

  // The supervisor's text streams as it is written. Whether a step's text is the plan or the answer is only certain when
  // the step ends (a step that calls a tool wrote its plan), so: before any data has come back it streams into a plan
  // note; once data has come back it streams as the answer. Should a tool call still follow, the streamed answer is
  // taken back and kept as a note; should a "plan" step end without a tool call, it was the answer after all.
  let text = '';                      // the supervisor's text of its current step
  let noteId: string | undefined;     // the plan note that text is streaming into
  let asAnswer = false;               // this step streams as the answer
  let dataBack = false;               // a data source has answered in this turn

  const streamPlan = () => {
    noteId ??= nextId('note');
    sink.trace({ id: noteId, kind: 'note', text: tidy(text) });
  };

  const supervisor = (type: string, p: Payload | undefined) => {
    switch (type) {
      case 'text-delta': {
        const delta = p?.text ?? p?.textDelta ?? '';
        text += delta;
        if (asAnswer) sink.answer(delta);
        else if (text.trim()) streamPlan();
        break;
      }
      case 'tool-call-input-streaming-start':
      case 'tool-call': {
        // Text written before a tool call is the plan, not the answer.
        if (asAnswer && text.trim()) {
          sink.retract();
          streamPlan();
        }
        text = '';
        noteId = undefined;
        asAnswer = false;
        const toolName = String(p?.toolName ?? '');
        if (toolName === clarifyToolName) break; // the question to the user is shown with the answer, not as a step
        const detail = type === 'tool-call' ? detailOf(p?.args) : '';
        if (toolName.startsWith(HANDOVER) && p?.toolCallId) {
          sourceOf.set(toolName.slice(HANDOVER.length), p.toolCallId);
          latestSource = p.toolCallId;
        }
        sink.trace({ id: String(p?.toolCallId), kind: 'tool', label: describeTool(toolName, spaceName), status: 'running', ...(detail ? { text: detail } : {}) });
        break;
      }
      case 'tool-result': {
        if (p?.toolName === clarifyToolName) break;
        const error = typeof p?.result?.error === 'string' ? p.result.error : '';
        sink.trace({ id: String(p?.toolCallId), kind: 'tool', label: describeTool(String(p?.toolName ?? ''), spaceName), status: error ? 'error' : 'done', ...(error ? { text: clip(error) } : {}) });
        dataBack = true;
        break;
      }
      case 'step-finish':
        if (p?.stepResult?.reason !== 'tool-calls') finishAnswer();
        text = '';
        noteId = undefined;
        asAnswer = dataBack; // the next step streams as the answer once data is back
        break;
    }
  };

  // A step that called no tool is the final answer. If it streamed as a plan note, move it to the answer.
  const finishAnswer = () => {
    if (asAnswer || !text.trim()) return;
    if (noteId) sink.trace({ id: noteId, kind: 'note', text: '' });
    sink.answer(text);
  };

  // Inside a handover only the data agent's tool calls matter: loading all rows, and errors from Genie.
  const specialist = (source: string, type: string, p: Payload | undefined) => {
    const error = type === 'tool-result' && typeof p?.result?.error === 'string' ? clip(p.result.error, 200) : '';
    if (String(p?.toolName ?? '').startsWith(FETCH_FULL) && (type === 'tool-call' || type === 'tool-result')) {
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
        const title = event.title ? tidy(event.title) : undefined;
        sink.trace({ id: `${parent}:q:${event.id}`, kind: 'progress', step: 'query', parent, status: event.status, ...(title ? { text: title } : {}) });
        return;
      }
      const text = event.text.trim(); // shown in full: the user follows Genie's reasoning as it goes
      const key = parent ?? '';
      if (!text || lastThought.get(key) === text) return;
      lastThought.set(key, text);
      sink.trace({ id: nextId('progress'), kind: 'progress', step: event.kind, parent, text });
    },
    // Safety net: if the stream ended without a closing step, whatever text is left is the answer.
    end() {
      finishAnswer();
      text = '';
    },
  };
}
