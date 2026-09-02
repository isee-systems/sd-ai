class Logger {
    // SDAI_TEST_MODE is how the main process tells a spawned sub-process (the
    // sandboxed AgentWorker) to stay quiet: NODE_ENV / JEST_WORKER_ID live only
    // in the main process and do not cross the bwrap env allowlist, so the
    // worker's logger would otherwise print. WorkerSpawner forwards this flag
    // whenever the main process is itself in test/eval mode.
    //
    // Read on every call rather than captured once. Nearly everything imports this
    // module transitively, so a value snapshotted when the first importer loaded it
    // is a snapshot of whichever module happened to be first — and evals/run.js sets
    // SDAI_TEST_MODE in its body, which ES modules run only after every one of its
    // static imports has already been evaluated. Snapshotting made adding one
    // ordinary import to run.js enough to dump engine logs over the progress bar.
    get isTestMode() {
        return process.env.NODE_ENV === 'test'
            || process.env.JEST_WORKER_ID !== undefined
            || process.env.SDAI_TEST_MODE === 'true';
    }

    log(...args) {
        if (!this.isTestMode) {
            console.log(...args);
        }
    }

    error(...args) {
        if (!this.isTestMode) {
            console.error(...args);
        }
    }

    warn(...args) {
        if (!this.isTestMode) {
            console.warn(...args);
        }
    }

    info(...args) {
        if (!this.isTestMode) {
            console.info(...args);
        }
    }

    debug(...args) {
        if (!this.isTestMode) {
            console.debug(...args);
        }
    }
}

const logger = new Logger();

export default logger;