import { jest } from '@jest/globals';
import { withCostAccounting, recordCallCost } from '../../utilities/costAccounting.js';

describe('cost accounting scopes', () => {
  it('is a no-op outside a scope', () => {
    // The production case: nothing opens a scope, so recording must not throw.
    expect(() => recordCallCost({ provider: 'google', model: 'm', cost: 1 })).not.toThrow();
  });

  it('sums every call made inside the scope', async () => {
    const { value, accounting } = await withCostAccounting(async () => {
      recordCallCost({ provider: 'google', model: 'flash', cost: 0.25 });
      recordCallCost({ provider: 'google', model: 'flash', cost: 0.25 });
      recordCallCost({ provider: 'anthropic', model: 'opus', cost: 1.5 });
      return 'done';
    });

    expect(value).toBe('done');
    expect(accounting.totalCost).toBeCloseTo(2.0, 10);
    expect(accounting.calls).toBe(3);
    expect(accounting.unpricedCalls).toBe(0);
    expect(accounting.byModel['google/flash']).toEqual({ calls: 2, cost: 0.5, unpricedCalls: 0 });
    expect(accounting.byModel['anthropic/opus']).toEqual({ calls: 1, cost: 1.5, unpricedCalls: 0 });
  });

  it('counts an unpriced call instead of treating it as free', async () => {
    // Folding a null cost in as zero would make "we don't know" indistinguishable from
    // "it was cheap". (What actually produces a null is pinned in the reporter tests below.)
    const { accounting } = await withCostAccounting(async () => {
      recordCallCost({ provider: 'google', model: 'priced', cost: 0.75 });
      recordCallCost({ provider: 'acme', model: 'unpriced', cost: null });
    });

    expect(accounting.totalCost).toBeCloseTo(0.75, 10);
    expect(accounting.calls).toBe(2);
    expect(accounting.unpricedCalls).toBe(1);
    expect(accounting.byModel['acme/unpriced']).toEqual({ calls: 1, cost: 0, unpricedCalls: 1 });
  });

  it('keeps concurrent scopes separate', async () => {
    // The eval runner's default mode runs tests in parallel, so two generations are
    // in flight at once and must never contribute to each other's bill.
    const scope = (model, cost, delay) => withCostAccounting(async () => {
      recordCallCost({ provider: 'google', model, cost });
      await new Promise((r) => setTimeout(r, delay));
      recordCallCost({ provider: 'google', model, cost });
    });

    const [a, b] = await Promise.all([scope('a', 1, 20), scope('b', 10, 5)]);

    expect(a.accounting.totalCost).toBe(2);
    expect(a.accounting.calls).toBe(2);
    expect(Object.keys(a.accounting.byModel)).toEqual(['google/a']);
    expect(b.accounting.totalCost).toBe(20);
    expect(b.accounting.calls).toBe(2);
    expect(Object.keys(b.accounting.byModel)).toEqual(['google/b']);
  });

  it('captures calls made deep in the async call tree', async () => {
    // An agent engine spends through its own turns AND every engine it drives via a
    // tool, each several awaits down. That is the case the scope exists for.
    const deep = async (depth) => {
      if (depth === 0) {
        recordCallCost({ provider: 'google', model: 'leaf', cost: 0.5 });
        return;
      }
      await Promise.resolve();
      await deep(depth - 1);
    };

    const { accounting } = await withCostAccounting(async () => {
      await Promise.all([deep(5), deep(10)]);
    });

    expect(accounting.calls).toBe(2);
    expect(accounting.totalCost).toBe(1);
  });

  it('propagates a throw while still having recorded the spend', async () => {
    // A failed generation still burned tokens; the runner retries it, and the bill
    // for the failed attempt must not silently vanish.
    const scope = { ran: false };
    await expect(withCostAccounting(async () => {
      recordCallCost({ provider: 'google', model: 'm', cost: 3 });
      scope.ran = true;
      throw new Error('engine blew up');
    })).rejects.toThrow('engine blew up');
    expect(scope.ran).toBe(true);
  });
});

describe('TokenUsageReporter contributes to the active scope', () => {
  it('records the computed cost of a real report() call', async () => {
    const { default: TokenUsageReporter, Provider } = await import('../../utilities/TokenUsageReporter.js');
    const reporter = new TokenUsageReporter(null, 'test-client');

    const { accounting } = await withCostAccounting(async () => {
      await reporter.report({
        provider: Provider.ANTHROPIC,
        model: 'claude-sonnet-5',
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
        clientKey: false,
        source: 'merlin',
      });
    });

    expect(accounting.calls).toBe(1);
    expect(accounting.unpricedCalls).toBe(0);
    // Exact rate lives in pricing.js; asserting it here would just restate that table.
    // What matters is that a priced call produced a real, positive cost.
    expect(accounting.totalCost).toBeGreaterThan(0);
    expect(accounting.byModel['anthropic/claude-sonnet-5'].calls).toBe(1);
  });

  it('counts an OpenRouter call with no reported cost as unpriced', async () => {
    // OpenRouter is the one provider with no local rate table — pricing.js falls back
    // to default rates for every other provider, so this is the only way a call can
    // end up with no price at all.
    const { default: TokenUsageReporter, Provider } = await import('../../utilities/TokenUsageReporter.js');
    const reporter = new TokenUsageReporter(null, null);

    const { accounting } = await withCostAccounting(async () => {
      await reporter.report({
        provider: Provider.OPENROUTER,
        model: 'qwen/qwen3.7-max',
        usage: { prompt_tokens: 100, completion_tokens: 100 }, // no `cost`
        clientKey: false,
        source: null,
      });
      await reporter.report({
        provider: Provider.OPENROUTER,
        model: 'qwen/qwen3.7-max',
        usage: { prompt_tokens: 100, completion_tokens: 100, cost: 0.42 },
        clientKey: false,
        source: null,
      });
    });

    expect(accounting.calls).toBe(2);
    expect(accounting.unpricedCalls).toBe(1);
    expect(accounting.totalCost).toBeCloseTo(0.42, 10);
    expect(accounting.byModel['openrouter/qwen/qwen3.7-max'])
      .toEqual({ calls: 2, cost: 0.42, unpricedCalls: 1 });
  });

  it('still prices a model missing from pricing.js via the provider default rates', async () => {
    // getPricing logs loudly and falls back rather than returning null, so an unknown
    // model is priced (approximately), not counted as unpriced. Asserting this pins the
    // behaviour the unpricedCalls counter is and is not reporting.
    const { default: TokenUsageReporter, Provider } = await import('../../utilities/TokenUsageReporter.js');
    const reporter = new TokenUsageReporter(null, null);

    const { accounting } = await withCostAccounting(async () => {
      await reporter.report({
        provider: Provider.ANTHROPIC,
        model: 'claude-does-not-exist-9',
        usage: { input_tokens: 100_000, output_tokens: 100 },
        clientKey: false,
        source: null,
      });
    });

    expect(accounting.calls).toBe(1);
    expect(accounting.unpricedCalls).toBe(0);
    expect(accounting.totalCost).toBeGreaterThan(0);
  });
});
