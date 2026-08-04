import { z } from 'zod';
import config from '../../../config.js';
import logger from '../../../utilities/logger.js';
import TokenUsageReporter, { Provider } from '../../../utilities/TokenUsageReporter.js';
import { mediaBlock } from '../../utilities/ToolResultFormatter.js';
import { createErrorResponse, selectImageModel } from './toolHelpers.js';

/**
 * generate_image — the only place in the server that produces pixels.
 *
 * The picture is put in the session's MediaStore and the model is handed a
 * handle, never bytes: that is what lets an image be passed to a client tool, or
 * looked at again with view_media, without base64 ever entering the
 * conversation.
 *
 * The generator is injected (see createGeminiImageGenerator / createOpenRouterImageGenerator)
 * for the same reason RagStore injects its embedder: it decouples the image
 * provider from the chat provider, and it is what makes this tool testable with a
 * deterministic fake and no network call.
 */

// Heavy SDKs are lazy-loaded — most sessions never generate an image.
let _GoogleGenAI;
const loadGoogleGenai = async () => _GoogleGenAI ??= (await import('@google/genai')).GoogleGenAI;
let _OpenRouter;
const loadOpenRouter = async () => _OpenRouter ??= (await import('@openrouter/sdk')).OpenRouter;

// Same slug convention LLMWrapper uses: a '/' means an OpenRouter model id.
const OPEN_ROUTER_SLUG_REGEX = /\//;

/**
 * Gemini image generation via generateContent.
 *
 * generateContent rather than models.generateImages (Imagen), because it accepts
 * reference images — which is what referenceMediaIds needs, and Imagen does not
 * take them.
 */
export function createGeminiImageGenerator(clientId) {
  let client = null;

  return {
    async generate({ model, prompt, aspectRatio, references }) {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('Image generation needs GEMINI_API_KEY, which is not set on this server.');
      }

      if (!client) {
        const GoogleGenAI = await loadGoogleGenai();
        client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      }

      const parts = [{ text: prompt }];
      for (const reference of references) {
        parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.base64 } });
      }

      const response = await client.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['IMAGE', 'TEXT'],
          ...(aspectRatio ? { imageConfig: { aspectRatio } } : {})
        }
      });

      // Report before inspecting the result, so a safety-filtered generation that
      // produced no image is still billed and logged — it consumed input tokens
      // and, usually, thinking tokens.
      if (response.usageMetadata) {
        new TokenUsageReporter(config.tokenReporterURL, clientId)
          .report({ provider: Provider.GOOGLE, model, usage: response.usageMetadata, clientKey: false })
          .catch(() => {});
      }

      const candidate = response.candidates?.[0];
      const images = (candidate?.content?.parts ?? [])
        .filter(part => part.inlineData?.data)
        .map(part => ({ mimeType: part.inlineData.mimeType || 'image/png', base64: part.inlineData.data }));

      return {
        images,
        text: (candidate?.content?.parts ?? []).filter(p => p.text).map(p => p.text).join('\n'),
        // Whatever the API said about why it stopped, so the error path can be
        // specific rather than "no image was returned".
        finishReason: candidate?.finishReason ?? response.promptFeedback?.blockReason ?? null
      };
    }
  };
}

/** OpenRouter image generation, for a slug-style model id. */
export function createOpenRouterImageGenerator(clientId) {
  let client = null;

  return {
    async generate({ model, prompt, references }) {
      if (!process.env.OPEN_ROUTER_API_KEY) {
        throw new Error('Image generation via OpenRouter needs OPEN_ROUTER_API_KEY, which is not set on this server.');
      }

      if (!client) {
        const OpenRouter = await loadOpenRouter();
        client = new OpenRouter({ apiKey: process.env.OPEN_ROUTER_API_KEY });
      }

      // `imageUrl`, not `image_url` — see hydrateMessagesForOpenRouter. The SDK validates
      // the request before remapping the key, so snake_case fails the content-part
      // union rather than reaching the API. Only reachable with referenceMediaIds; a
      // prompt-only call is text parts and would never have shown this up.
      const content = [{ type: 'text', text: prompt }];
      for (const reference of references) {
        content.push({
          type: 'image_url',
          imageUrl: { url: `data:${reference.mimeType};base64,${reference.base64}` }
        });
      }

      const completion = await client.chat.send({
        chatRequest: {
          model,
          modalities: ['image', 'text'],
          messages: [{ role: 'user', content }]
        }
      });

      if (completion?.usage) {
        new TokenUsageReporter(config.tokenReporterURL, clientId)
          .report({ provider: Provider.OPENROUTER, model, usage: completion.usage, clientKey: false })
          .catch(() => {});
      }

      const message = completion?.choices?.[0]?.message;
      const images = (message?.images ?? [])
        .map(image => image?.imageUrl?.url)
        .filter(url => typeof url === 'string' && url.startsWith('data:'))
        .map(url => {
          const [header, base64] = url.split(',');
          return { mimeType: header.slice(5).split(';')[0] || 'image/png', base64 };
        });

      return {
        images,
        text: typeof message?.content === 'string' ? message.content : '',
        finishReason: completion?.choices?.[0]?.finishReason ?? null
      };
    }
  };
}

/** Picks the generator that matches the configured model id. */
export function createImageGeneratorFor(model, clientId) {
  return OPEN_ROUTER_SLUG_REGEX.test(model)
    ? createOpenRouterImageGenerator(clientId)
    : createGeminiImageGenerator(clientId);
}

export function createGenerateImageTool(sessionManager, sessionId, mediaStore, provider, generator = null) {
  return {
    description: `Generate an image and keep it in this session, ready to be used.

Returns a media handle (med_...), not the picture's bytes — pass that handle to a client tool that
accepts media (its schema will say which argument takes one) to put the image somewhere, or call
view_media to look at it again later.

Use it for imagery you can legitimately invent: a decorative header, an icon, a texture, an
illustration, a schematic. Do not use it for a picture that has to depict something real, be
somebody's actual brand, or be legally theirs — a generated photograph of "the user's factory" is a
fabrication. Ask the user for those instead.`,
    supportedModes: ['sfd', 'cld'],
    // Offered only when the client said it handles images *and* some client tool
    // actually takes one. A handle with nowhere to go is a billed image-generation
    // call whose result the model can do nothing with, and this tool's own
    // description tells it to "pass that handle to a client tool that accepts
    // media" — advice that is a dead end when no such tool is registered. Stella
    // registers its media tools only for interface authoring, so a plain modeling
    // session with Merlin or Socrates never sees this tool.
    requiresMedia: 'sink',
    inputSchema: z.object({
      prompt: z.string().describe('What to draw, described fully. Say what the image is for as well as what is in it — a page header behaves differently from an icon.'),
      aspectRatio: z.enum(['1:1', '4:3', '3:4', '16:9', '9:16']).optional().describe('Shape of the image. Default 1:1.'),
      referenceMediaIds: z.array(z.string()).optional().describe('Media handles of existing images to use as visual reference, e.g. to match the style of something already in the interface.'),
      review: z.boolean().optional().describe('Whether to show you the generated image so you can check it. Default true; set false only when you are certain you do not need to look.')
    }),
    handler: async ({ prompt, aspectRatio, referenceMediaIds, review }) => {
      const model = selectImageModel(provider);

      try {
        // Resolved before the API call, so a bad handle costs nothing.
        const references = [];
        for (const mediaId of referenceMediaIds ?? []) {
          if (!mediaStore.exists(mediaId)) {
            return createErrorResponse(
              `'${mediaId}' is not an image I have, so it cannot be used as a reference. `
              + `referenceMediaIds takes handles returned by an earlier generate_image or tool call.`);
          }
          const meta = mediaStore.meta(mediaId);
          references.push({ mimeType: meta.mimeType, base64: mediaStore.readBase64(mediaId) });
        }

        const engine = generator ?? createImageGeneratorFor(model, sessionManager.getSession(sessionId)?.clientId);
        const { images, text, finishReason } = await engine.generate({ model, prompt, aspectRatio, references });

        if (images.length === 0) {
          // Safety filtering is the common case here, and it needs an actionable
          // message: told only "no image was returned", a model retries the same
          // prompt verbatim and fails the same way.
          const blocked = /SAFETY|PROHIBITED|RECITATION|BLOCK/i.test(String(finishReason ?? ''));
          return createErrorResponse(blocked
            ? `The image was refused by the provider's content filter (${finishReason}). Rewrite the `
              + `prompt rather than retrying it: describe the subject more plainly, drop anything `
              + `naming a real person, brand or artistic style, and ask for an illustration rather `
              + `than a photograph.${text ? ` The provider said: ${text}` : ''}`
            : `No image came back${finishReason ? ` (${finishReason})` : ''}.${text ? ` The provider said: ${text}` : ''}`);
        }

        const stored = [];
        for (const image of images.slice(0, config.mediaImageMaxCount)) {
          stored.push(mediaStore.put(Buffer.from(image.base64, 'base64'), {
            name: `generated-${stored.length + 1}.${image.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`,
            mimeType: image.mimeType,
            source: 'generated',
            description: prompt,
            prompt
          }));
        }

        const summary = stored.map(meta => ({
          mediaId: meta.mediaId,
          mimeType: meta.mimeType,
          bytes: meta.bytes
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                images: summary,
                message: 'Pass a mediaId to a client tool that accepts media to use the image, or '
                       + 'call view_media to look at it again.'
              })
            },
            // The model looks at what it made by default. Generating blind and
            // reporting success is how a six-fingered hand ends up in a header.
            ...(review === false ? [] : stored.map(mediaBlock))
          ],
          isError: false
        };
      } catch (error) {
        logger.error(`generate_image failed (model=${model}):`, error);
        return createErrorResponse(`Could not generate the image: ${error.message}`, error);
      }
    }
  };
}
