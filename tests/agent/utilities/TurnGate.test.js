import { jest } from '@jest/globals';
import { TurnGate } from '../../../agent/utilities/TurnGate.js';

// A turn that runs until the test says it is done.
function controllableOrchestrator(name) {
  let finish;
  const orchestrator = {
    name,
    queued: [],
    started: [],
    queueMessage: jest.fn((m) => orchestrator.queued.push(m)),
    stopIteration: jest.fn(),
    finish: () => finish()
  };
  const start = jest.fn((o, message) => {
    o.started.push(message);
    return new Promise((resolve) => { finish = resolve; });
  });
  return { orchestrator, start };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('TurnGate', () => {
  it('starts a turn when idle and queues later messages on the same orchestrator', async () => {
    const gate = new TurnGate();
    const { orchestrator, start } = controllableOrchestrator('a');

    gate.submit(orchestrator, 'first', start);
    await flush();
    gate.submit(orchestrator, 'second', start);

    expect(orchestrator.started).toEqual(['first']);
    expect(orchestrator.queued).toEqual(['second']);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not strand a message on a new orchestrator while the old turn is still running', async () => {
    // The production failure: after an agent switch the message was queued on the
    // new orchestrator, whose loop was not running, and never processed.
    const gate = new TurnGate();
    const old = controllableOrchestrator('gemini');
    const next = controllableOrchestrator('claude');

    gate.submit(old.orchestrator, 'old turn', old.start);
    await flush();

    gate.submit(next.orchestrator, 'after switch', next.start);
    await flush();
    expect(next.orchestrator.queued).toEqual([]);
    expect(next.orchestrator.started).toEqual([]); // waits for the old turn to end

    old.orchestrator.finish();
    await flush();
    expect(next.orchestrator.started).toEqual(['after switch']);
  });

  it('queues further messages behind the new agent while it waits for the old turn', async () => {
    const gate = new TurnGate();
    const old = controllableOrchestrator('gemini');
    const next = controllableOrchestrator('claude');

    gate.submit(old.orchestrator, 'old turn', old.start);
    await flush();
    gate.submit(next.orchestrator, 'one', next.start);
    gate.submit(next.orchestrator, 'two', next.start);

    expect(gate.owner).toBe(next.orchestrator);
    expect(next.orchestrator.queued).toEqual(['two']);

    old.orchestrator.finish();
    await flush();
    expect(next.orchestrator.started).toEqual(['one']);
    expect(next.start).toHaveBeenCalledTimes(1); // never a second concurrent turn
  });

  it('goes idle when the turn ends, so the next message starts a new one', async () => {
    const gate = new TurnGate();
    const { orchestrator, start } = controllableOrchestrator('a');

    gate.submit(orchestrator, 'first', start);
    await flush();
    orchestrator.finish();
    await flush();
    expect(gate.owner).toBeNull();

    gate.submit(orchestrator, 'second', start);
    await flush();
    expect(orchestrator.started).toEqual(['first', 'second']);
  });

  it('frees the slot when a turn fails', async () => {
    const gate = new TurnGate();
    const orchestrator = { queueMessage: jest.fn() };
    const start = jest.fn().mockRejectedValueOnce(new Error('provider down')).mockResolvedValue(undefined);

    await gate.submit(orchestrator, 'first', start);
    expect(gate.owner).toBeNull();

    await gate.submit(orchestrator, 'second', start);
    expect(start).toHaveBeenCalledTimes(2);
  });
});
