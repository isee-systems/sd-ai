/**
 * Decides, for one worker, whether a chat message starts a turn or queues behind the
 * turn already in flight — and on which orchestrator.
 *
 * A turn belongs to the orchestrator that started it, and only that orchestrator's
 * loop drains its queue. An agent switch replaces the worker's orchestrator while a
 * turn may still be running on the old one. Queuing the next message on the new
 * orchestrator then strands it: nothing is running there to pick it up, and the user
 * waits until the session is reaped. Seen in production under load — a message sat
 * "queued (depth: 1)" for 34 minutes after a Gemini → Claude switch.
 *
 * So a message queues only when the running turn is the current orchestrator's own.
 * Otherwise it claims the slot and starts once the previous turn has wound down;
 * claiming immediately is what makes any further messages queue behind it rather
 * than start a second, concurrent turn on the same history.
 */
export class TurnGate {
  // The orchestrator whose turn holds the slot, or null when idle.
  #owner = null;
  // Settles when the most recently scheduled turn has finished. Never rejects.
  #settled = Promise.resolve();

  /** The orchestrator running (or about to run) a turn, or null when idle. */
  get owner() {
    return this.#owner;
  }

  /**
   * @param {Object} orchestrator  The worker's current orchestrator
   * @param {string} message       The user's chat message
   * @param {Function} start       (orchestrator, message) => Promise, begins a turn
   * @returns {Promise<void>} Settles when the turn this message joined has finished
   */
  submit(orchestrator, message, start) {
    if (this.#owner === orchestrator) {
      orchestrator.queueMessage(message);
      return this.#settled;
    }

    this.#owner = orchestrator;
    const settled = this.#settled
      .then(() => start(orchestrator, message))
      .catch(() => { /* the orchestrator reports its own failures to the client */ })
      .finally(() => {
        // A later submit (another agent switch) owns the slot now; leave it alone.
        if (this.#settled === settled) this.#owner = null;
      });
    this.#settled = settled;
    return settled;
  }
}
