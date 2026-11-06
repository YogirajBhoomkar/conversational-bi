import { createTool } from '@mastra/core/tools';
import { ClarificationSchema } from '../../contracts';
import { getCollector } from '../chat/collector';
import { clarifyToolName } from './prompts';

// The supervisor's way to ask the user to choose when a question is ambiguous. The question and options go to the UI
// with the final answer (as `clarification`), where they are shown as choices plus a free-text option.
export const createClarifyTool = () =>
  createTool({
    id: clarifyToolName,
    description: 'Ask the user to choose between a few readings of an ambiguous question. Shows the question and the options as choices; the user can also type their own answer.',
    inputSchema: ClarificationSchema,
    execute: async (clarification, { requestContext }) => {
      getCollector(requestContext).clarification = clarification;
      return { shown: true, note: 'The user sees the question and the options. End your turn now without writing anything else.' };
    },
  });
