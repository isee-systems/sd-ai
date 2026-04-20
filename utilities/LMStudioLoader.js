/**
 * LMStudioLoader — programmatically load/unload models in LM Studio via REST API (v1).
 *
 * Endpoints (LM Studio 0.4.0+):
 *   POST /api/v1/models/load   { model, context_length, gpu_offload }
 *   POST /api/v1/models/unload { instance_id }
 *   GET  /api/v0/models        list all models with state/loaded_context_length
 */

const LM_STUDIO_BASE = process.env.LM_STUDIO_BASE_URL ?? 'http://localhost:1234';

export async function listModels() {
    const res = await fetch(`${LM_STUDIO_BASE}/api/v0/models`);
    const json = await res.json();
    return json.data ?? [];
}

async function findLoadedInstance(modelId) {
    const models = await listModels();
    // Loaded instances have an instance_id like "modelId:N"
    return models.find(m => m.state === 'loaded' && m.id.startsWith(modelId));
}

/**
 * Ensure a model is loaded with the specified context length.
 * If already loaded at the correct context, does nothing.
 * If loaded at a different context, unloads first then reloads.
 * If not loaded, loads it.
 *
 * @param {string} modelId  LM Studio model identifier (e.g. "moonshotai_kimi-k2.5")
 * @param {number} contextLength  Desired context window in tokens
 * @param {object} [opts]
 * @param {boolean} [opts.verbose=true]  Print status messages
 */
export async function ensureModelLoaded(modelId, contextLength, { verbose = true } = {}) {
    const loaded = await findLoadedInstance(modelId);

    if (loaded) {
        if (loaded.loaded_context_length === contextLength) {
            if (verbose) console.log(`  LM Studio: ${modelId} already loaded at ${contextLength.toLocaleString()} tokens — skipping reload`);
            return loaded.id;
        }
        // Wrong context — unload first
        if (verbose) console.log(`  LM Studio: ${modelId} loaded at ${loaded.loaded_context_length.toLocaleString()} tokens, reloading at ${contextLength.toLocaleString()}...`);
        await unloadModel(loaded.id, { verbose: false });
    } else {
        if (verbose) console.log(`  LM Studio: loading ${modelId} at ${contextLength.toLocaleString()} tokens...`);
    }

    return await loadModel(modelId, contextLength, { verbose });
}

/**
 * Load a model with the specified context length.
 * @returns {string} instance_id of the loaded model
 */
export async function loadModel(modelId, contextLength, { verbose = true } = {}) {
    const start = Date.now();
    const res = await fetch(`${LM_STUDIO_BASE}/api/v1/models/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId, context_length: contextLength }),
    });

    const json = await res.json();
    if (json.error) throw new Error(`LM Studio load failed: ${json.error}`);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    if (verbose) console.log(`  LM Studio: ${json.instance_id} loaded in ${elapsed}s`);
    return json.instance_id;
}

/**
 * Unload a model instance.
 * @param {string} instanceId  The instance_id returned from load (e.g. "moonshotai_kimi-k2.5:2")
 */
export async function unloadModel(instanceId, { verbose = true } = {}) {
    const res = await fetch(`${LM_STUDIO_BASE}/api/v1/models/unload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance_id: instanceId }),
    });

    const json = await res.json();
    if (json.error) throw new Error(`LM Studio unload failed: ${json.error}`);
    if (verbose) console.log(`  LM Studio: ${instanceId} unloaded`);
}
