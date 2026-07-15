class Logger {
    constructor() {
        // SDAI_TEST_MODE is how the main process tells a spawned sub-process (the
        // sandboxed AgentWorker) to stay quiet: NODE_ENV / JEST_WORKER_ID live only
        // in the main process and do not cross the bwrap env allowlist, so the
        // worker's logger would otherwise print. WorkerSpawner forwards this flag
        // whenever the main process is itself in test/eval mode.
        this.isTestMode = process.env.NODE_ENV === 'test'
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