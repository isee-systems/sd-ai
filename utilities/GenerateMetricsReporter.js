/**
 * GenerateMetricsReporter class for tracking and reporting engine usage metrics
 * Collects information about engine invocations and optionally posts to a remote URL
 */
class GenerateMetricsReporter {
    /**
     * @param {string|null} url - Optional URL to POST metrics to. If null, metrics are only logged locally.
     */
    constructor(url = null) {
        this.url = url;
        this.enabled = url !== null && url !== undefined && url !== '';
    }

    /**
     * Reports metrics for an engine generate call
     * @param {Object} metrics - The metrics to report
     * @param {string} metrics.engine - The name of the engine used
     * @param {string} [metrics.underlyingModel] - The underlying model (optional)
     * @param {number} metrics.duration - Time in milliseconds for the generate call
     */
    async report(metrics) {
        const reportData = {
            engine: metrics.engine,
            underlyingModel: metrics.underlyingModel || null,
            duration: metrics.duration,
            timestamp: new Date().toISOString()
        };

        if (!this.enabled) {
            // If no URL configured, just log locally (optional)
            // console.log('Reporter (disabled):', reportData);
            return;
        }

        try {
            const response = await fetch(this.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(reportData)
            });

            if (!response.ok) {
                console.error(`Reporter: Failed to post metrics to ${this.url}. Status: ${response.status}`);
            }
        } catch (error) {
            console.error(`Reporter: Error posting metrics to ${this.url}:`, error.message);
        }
    }
}

export default GenerateMetricsReporter;
