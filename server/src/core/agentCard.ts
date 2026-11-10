// Our own agent card: what this assistant can do, for a catalogue or another agent to discover it. Shaped like an A2A
// agent card, built only from configuration: the data areas (spaces) as skills, and the Send feedback email setup as
// a declared extension. Never the system prompt, agent or tool names, space ids or the model: Mastra's own card
// published the whole prompt, so it is closed (edge/mastra/security.ts) and this one replaces it.
// It describes the HTTP API (POST <prefix>/chat, Server-Sent Events); it is not an A2A JSON-RPC endpoint.
import type { AgentCard, GenieSpace } from '../contracts';
import type { FeedbackSettings } from '../config/load';
import { firstSentence } from './agents/prompts';

export const FEEDBACK_EXTENSION = 'urn:conversational-bi:feedback-email';

export function buildAgentCard(args: { spaces: GenieSpace[]; feedback: FeedbackSettings; prefix: string; build: string; contract: string }): AgentCard {
  const { spaces, feedback, prefix, build, contract } = args;
  const on = Boolean(feedback.to?.length);
  return {
    name: 'Conversational BI',
    description: `Answers business questions in plain language from ${spaces.length === 1 ? 'one data area' : `${spaces.length} data areas`}, with the table, charts and the SQL behind each answer. Out-of-scope questions are declined.`,
    url: `${prefix}/chat`,
    version: build,
    contract,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [
        {
          uri: FEEDBACK_EXTENSION,
          description: on
            ? 'Send feedback: every answer offers a button that opens a prepared email (the type of problem, an optional comment and references to trace the answer) to the configured address.'
            : 'Send feedback email: switched off (BI_FEEDBACK_EMAIL is not set).',
          required: false,
          params: { enabled: on, to: on ? feedback.to : [], format: feedback.format, content: feedback.content, ...(feedback.format === 'text' ? { maxUrlChars: feedback.maxUrlChars } : {}) },
        },
      ],
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/markdown', 'application/json'],
    skills: spaces.map((s) => ({ id: s.key, name: s.name, description: firstSentence(s.description), tags: ['data'], examples: s.examples ?? [] })),
  };
}
