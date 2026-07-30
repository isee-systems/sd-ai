import { z } from 'zod';
import { mediaBlock } from '../../utilities/ToolResultFormatter.js';
import { createErrorResponse } from './toolHelpers.js';

/**
 * view_media — look at a stored image again.
 *
 * The safety valve for the three moments where a picture stops being visible
 * without ceasing to exist: an agent switch (the cross-provider normalizers
 * collapse history to text), context summarization (the summarizer keeps text
 * only), and the per-call hydration budget (older images degrade to their
 * description so the newest ones render).
 *
 * All three are honest degradations rather than losses precisely because of this
 * tool: the bytes stay on disk, the handle stays visible in the transcript, and
 * calling this puts the picture back in front of the model — which also moves it
 * to the newest position, so the budget renders it again.
 */
export function createViewMediaTool(mediaStore) {
  return {
    description: `Look at an image this session is holding, by its media handle (med_...).

Use it when a handle appears in the conversation but you cannot see the picture — after switching
agents, after a long conversation, or to check something you generated several steps ago.`,
    supportedModes: ['sfd', 'cld'],
    // Needs images to be able to exist at all, which is a weaker condition than
    // generate_image's: either a client tool that takes a handle (so generate_image
    // is offered and can make one) or one that returns media (so a picture can
    // arrive from the client). With neither, there is never a handle to look at
    // again and this is pure noise in the tool list.
    requiresMedia: 'any',
    inputSchema: z.object({
      mediaId: z.string().describe('The media handle to look at, e.g. med_0123456789abcdef')
    }),
    handler: async ({ mediaId }) => {
      if (!mediaStore.exists(mediaId)) {
        return createErrorResponse(
          `'${mediaId}' is not an image this session is holding. Handles look like `
          + `med_0123456789abcdef and come from generate_image or a tool that returned a picture. `
          + `An image can also be dropped once the session has collected a lot of them — if that is `
          + `what happened, generate it again.`);
      }

      const meta = mediaStore.meta(mediaId);

      return {
        content: [
          { type: 'text', text: mediaStore.describeForModel(meta) },
          mediaBlock(meta)
        ],
        isError: false
      };
    }
  };
}
