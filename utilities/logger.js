class Logger {
    constructor() {
        this.isTestMode = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
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