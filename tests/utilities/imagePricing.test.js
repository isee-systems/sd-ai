/**
 * Image-generation cost reporting.
 *
 * An image model bills output at two very different rates -- text/thinking at one
 * rate and the generated picture at up to ten times that -- so charging the whole
 * of candidatesTokenCount at the text rate would under-report a generation by
 * roughly 10x. These tests pin the split, and check the arithmetic against
 * Google's own published per-image prices, which is the only external number
 * available to check it against.
 *
 * Source: https://ai.google.dev/gemini-api/docs/pricing
 */
import TokenUsageReporter, { Provider } from '../../utilities/TokenUsageReporter.js';
import { getPricing } from '../../utilities/pricing.js';

// #calculateCost is private; report() is the public surface and it logs the
// totals. Reach the arithmetic the same way the reporter does instead of
// duplicating it: compute from the pricing table exactly as the reporter states.
function costOf(model, { input = 0, outputText = 0, outputImage = 0, cached = 0, thoughts = 0 }) {
  const pricing = getPricing(Provider.GOOGLE, model, input);
  const per = (count, rate) => (count / 1_000_000) * (rate ?? 0);
  return per(input - cached, pricing.inputTokens)
       + per(cached, pricing.cachedTokens)
       + per(outputText, pricing.outputTokens)
       + per(thoughts, pricing.outputTokens)
       + per(outputImage, pricing.outputImageTokens);
}

describe('image generation pricing', () => {
  describe('the published per-image prices come out of the token rates', () => {
    // Google quotes both a per-1M-token rate and a per-image price for each
    // resolution. They have to agree, and if a future edit changes one rate
    // without the other, this is what catches it.
    it('gemini-3-pro-image: 1120 tokens for a 1K/2K image is $0.134', () => {
      expect(costOf('gemini-3-pro-image', { outputImage: 1120 })).toBeCloseTo(0.1344, 4);
    });

    it('gemini-3-pro-image: 2000 tokens for a 4K image is $0.24', () => {
      expect(costOf('gemini-3-pro-image', { outputImage: 2000 })).toBeCloseTo(0.24, 4);
    });

    it('gemini-3.1-flash-image lands inside its published $0.045-$0.151 range', () => {
      const oneK = costOf('gemini-3.1-flash-image', { outputImage: 1120 });
      expect(oneK).toBeGreaterThanOrEqual(0.045);
      expect(oneK).toBeLessThanOrEqual(0.151);
    });
  });

  describe('image output is not billed at the text rate', () => {
    it('charges an image about ten times what the same tokens of text cost', () => {
      const asImage = costOf('gemini-3-pro-image', { outputImage: 1120 });
      const asText = costOf('gemini-3-pro-image', { outputText: 1120 });

      expect(asImage / asText).toBeCloseTo(10, 1);
    });

    it('bills text, thinking and image in one generation', () => {
      // A realistic generation: a prompt, some thinking, a sentence of commentary
      // and one 1K image.
      const total = costOf('gemini-3-pro-image', {
        input: 400, outputText: 60, thoughts: 300, outputImage: 1120
      });

      const expected = (400 / 1e6) * 2.00      // input
                     + (60 / 1e6) * 12.00      // text out
                     + (300 / 1e6) * 12.00     // thinking, at the output rate
                     + (1120 / 1e6) * 120.00;  // the picture
      expect(total).toBeCloseTo(expected, 8);
    });
  });

  describe('a text-only model is unaffected', () => {
    it('has no image rate and so costs nothing extra', () => {
      expect(getPricing(Provider.GOOGLE, 'gemini-3.6-flash').outputImageTokens).toBeUndefined();

      // Stated as a comparison rather than against literal rates: the published
      // rates move, but image tokens billed against a model that has no image
      // rate must add nothing -- never silently fall back to the text rate.
      const textOnly = costOf('gemini-3.6-flash', { input: 1000, outputText: 500 });
      expect(costOf('gemini-3.6-flash', { input: 1000, outputText: 500, outputImage: 1120 }))
        .toBe(textOnly);
    });
  });

  describe('modality split from usageMetadata', () => {
    // report() is async and logs; the split itself is what matters, so assert on
    // the payload it would POST by giving it a URL and capturing the fetch.
    async function reportedTokens(usage) {
      const original = global.fetch;
      let captured = null;
      global.fetch = async (_url, options) => {
        captured = JSON.parse(options.body);
        return { ok: true };
      };
      try {
        await new TokenUsageReporter('http://example.invalid/usage', 'client-1')
          .report({ provider: Provider.GOOGLE, model: 'gemini-3-pro-image', usage, clientKey: false });
      } finally {
        global.fetch = original;
      }
      return captured;
    }

    it('pulls IMAGE-modality tokens out of candidatesTokenCount', async () => {
      const payload = await reportedTokens({
        promptTokenCount: 400,
        candidatesTokenCount: 1180,
        candidatesTokensDetails: [
          { modality: 'TEXT', tokenCount: 60 },
          { modality: 'IMAGE', tokenCount: 1120 }
        ]
      });

      expect(payload.tokens.outputImageTokens).toBe(1120);
      // The remainder, so the two never double-count the same tokens.
      expect(payload.tokens.outputTokens).toBe(60);
    });

    it('treats a response with no IMAGE detail exactly as before', async () => {
      const payload = await reportedTokens({
        promptTokenCount: 100,
        candidatesTokenCount: 250
      });

      expect(payload.tokens.outputImageTokens).toBe(0);
      expect(payload.tokens.outputTokens).toBe(250);
    });

    it('never reports more image tokens than the output total', async () => {
      // Defensive: a provider that reported a detail larger than the total would
      // otherwise drive outputTokens negative and undercharge.
      const payload = await reportedTokens({
        promptTokenCount: 10,
        candidatesTokenCount: 100,
        candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 500 }]
      });

      expect(payload.tokens.outputImageTokens).toBe(100);
      expect(payload.tokens.outputTokens).toBe(0);
    });

    it('includes the image cost in the reported total', async () => {
      const payload = await reportedTokens({
        promptTokenCount: 400,
        candidatesTokenCount: 1180,
        candidatesTokensDetails: [
          { modality: 'TEXT', tokenCount: 60 },
          { modality: 'IMAGE', tokenCount: 1120 }
        ]
      });

      expect(payload.cost).toBeCloseTo(
        costOf('gemini-3-pro-image', { input: 400, outputText: 60, outputImage: 1120 }), 8);
      // Sanity: dominated by the picture, not the text.
      expect(payload.cost).toBeGreaterThan(0.13);
    });
  });
});
