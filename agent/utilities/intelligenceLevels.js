/**
 * Intelligence levels — resolution and client discovery.
 *
 * The whole ladder lives in `config.agentIntelligence`; this module is the only
 * thing that reads it. Everything the rest of the agent needs — which model, which
 * effort, which engine-tool lane, and what to advertise to clients — is derived
 * here, so adding or renaming a rung stays a config edit.
 *
 * Two invariants worth stating up front, because most of the code below exists to
 * uphold them:
 *
 *  1. A level may deliberately omit `effort`. That means "send no effort/thinking
 *     parameter at all and let the provider apply its own default", which is a
 *     different request from sending a low value. So the resolvers return
 *     `undefined` and every call site omits the key rather than passing undefined.
 *
 *  2. A provider with no ladder is not an error. It ignores the lever and keeps its
 *     `nativeAgentProviders` model — that absence is the "providers that support it"
 *     gate, which is why the OpenRouter brands need no entry here.
 */
import config from '../../config.js';
import logger from '../../utilities/logger.js';
import { getPricing } from '../../utilities/pricing.js';
import { Provider } from '../../utilities/TokenUsageReporter.js';

// Agent provider ids that have a pricing table we can derive a cost multiplier from.
// A provider outside this set still works; its levels simply carry no relativeCost.
const PRICED_PROVIDERS = new Set([Provider.ANTHROPIC, Provider.GOOGLE, Provider.OPENAI]);

// Longest level id worth echoing into a log line. The wire schemas cap `intelligence`
// well below this; the clamp here is belt-and-braces for any other caller.
const MAX_LOGGED_ID = 64;

/**
 * Make a client-supplied id safe to put in a log line.
 *
 * The value reaches us straight off the socket, so it is neither length-bounded nor
 * free of control characters unless something upstream said so. Unbounded it is a
 * disk-fill vector on a repeated bad request; with newlines in it, it forges log lines.
 */
function forLog(value) {
    const flattened = String(value).replace(/[\u0000-\u001f\u007f]/g, " ");
    return flattened.length > MAX_LOGGED_ID ? `${flattened.slice(0, MAX_LOGGED_ID)}…` : flattened;
}

/** The ordered ladder for a provider, or null when it doesn't participate. */
export function getLadder(provider) {
    const ladder = config.agentIntelligence?.providers?.[provider];
    return Array.isArray(ladder) && ladder.length > 0 ? ladder : null;
}

/** True when this provider honours the intelligence lever at all. */
export function supportsIntelligence(provider) {
    return getLadder(provider) !== null;
}

/**
 * The level id a provider uses when the client asks for nothing (or for something
 * it doesn't offer). Prefers the global default; falls back to the ladder's first
 * rung so a provider using its own vocabulary still has a usable floor.
 */
export function getDefaultLevelId(provider) {
    const ladder = getLadder(provider);
    if (!ladder) return null;
    const globalDefault = config.agentIntelligence?.defaultLevel;
    return ladder.some(l => l.id === globalDefault) ? globalDefault : ladder[0].id;
}

/**
 * Resolve a requested level id against a provider's ladder.
 *
 * Never throws and never rejects: an unknown id falls back to the provider's
 * default with a warning. A client may legitimately send an id that is valid for
 * the provider it was just using but not for the one it switched to, and that
 * should degrade rather than break the session.
 *
 * @returns {{id: string, level: Object}|null} null when the provider has no ladder.
 */
export function resolveLevel(provider, requestedId) {
    const ladder = getLadder(provider);
    if (!ladder) return null;

    const match = requestedId ? ladder.find(l => l.id === requestedId) : null;
    if (match) return { id: match.id, level: match };

    const fallbackId = getDefaultLevelId(provider);
    if (requestedId) {
        logger.warn(`[intelligence] provider "${provider}" has no level "${forLog(requestedId)}" — using "${fallbackId}"`);
    }
    return { id: fallbackId, level: ladder.find(l => l.id === fallbackId) };
}

/**
 * Engine-tool lane for a (provider, level), in precedence order:
 *   the level's own `toolModels` -> agentToolModels[provider][levelId]
 *   -> agentToolModels[provider][defaultLevel] -> agentToolModels.default[levelId]
 *   -> agentToolModels.default[defaultLevel].
 *
 * The defaultLevel steps are what let a provider name its rungs `fast`/`thorough`
 * without duplicating the entire shared tool table for those ids; the `default`
 * steps are what stop a provider override that covers only some levels from
 * blanking out the rest.
 */
export function resolveToolLane(provider, levelId) {
    const resolved = resolveLevel(provider, levelId);
    if (resolved?.level?.toolModels) return resolved.level.toolModels;

    const providerLanes = config.agentToolModels?.[provider] ?? config.agentToolModels?.default;
    if (!providerLanes) return null;

    // A provider entry written in the pre-levels shape puts the engine kinds at the top
    // level where a level id belongs. Every keyed lookup below would miss it and hand the
    // engine `underlyingModel: undefined`, so recognise it and use it as written.
    if (providerLanes.build || providerLanes.nonBuild) return providerLanes;

    const defaultId = config.agentIntelligence?.defaultLevel;
    const sharedLanes = config.agentToolModels?.default;
    const effectiveId = resolved?.id ?? levelId;

    const lane = providerLanes[effectiveId]
        ?? providerLanes[defaultId]
        ?? sharedLanes?.[effectiveId]
        ?? sharedLanes?.[defaultId]
        ?? null;

    // Silence here means the engine call goes out with no underlyingModel at all, which
    // surfaces far from the config mistake that caused it. Say so at the source.
    if (!lane) {
        logger.warn(`[intelligence] no engine-tool lane for provider "${provider}" level "${forLog(effectiveId)}" — check config.agentToolModels`);
    }
    return lane;
}

/** `standard` -> `Standard`, `very high` -> `Very High`. Only used when config omits a label. */
function titleCase(id) {
    return String(id)
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/**
 * Blended $/Mtok for a model, used only to compare two rungs of the same provider.
 *
 * Input and output rates are summed rather than weighted by an assumed traffic mix:
 * within a model family both scale together, so the *ratio* between two rungs is
 * insensitive to the weighting, and a made-up weight would imply a precision we
 * don't have. Tiered models are priced at their first tier.
 */
function blendedRate(provider, model) {
    const tier = getPricing(provider, model, 0);
    return (tier?.inputTokens ?? 0) + (tier?.outputTokens ?? 0);
}

/**
 * How much more a level costs than that provider's default level, as a multiplier.
 *
 * Derived from the real rates in pricing.js so the number a user sees tracks the
 * pricing table instead of drifting from it. Rounded to the nearest 0.5 — enough
 * precision to distinguish 2.5x from 5x, little enough to read as the estimate it is.
 *
 * This captures cost that comes from *changing model*. A rung that raises effort on
 * the same model bills at the same per-token rate while generating more tokens, so
 * its true cost is higher than the derived 1.0; those rungs set `relativeCost`
 * explicitly in config, which always wins over this calculation.
 */
function deriveRelativeCost(provider, level, baselineModel) {
    if (typeof level.relativeCost === 'number') return level.relativeCost;
    if (!PRICED_PROVIDERS.has(provider)) return undefined;

    const baseline = blendedRate(provider, baselineModel);
    if (!baseline) return undefined;

    const ratio = blendedRate(provider, level.model) / baseline;
    return Math.max(1, Math.round(ratio * 2) / 2);
}

// The payload is derived from static config, so build it once. Tests that mutate
// config call resetIntelligenceDiscoveryCache() to force a rebuild.
let _discoveryCache = null;

/** Test hook — drop the memoized discovery payload. */
export function resetIntelligenceDiscoveryCache() {
    _discoveryCache = null;
}

/**
 * The `intelligenceLevels` block of `session_ready`, derived wholesale from config.
 *
 * Ladders are per provider, so the payload is too. A provider that doesn't
 * participate is simply absent from `byProvider` — that absence is how the client
 * knows to hide the control rather than needing a separate "supported" list.
 *
 * Only providers a client can actually select are advertised. A ladder may be parked
 * in config ahead of its provider being enabled (the openai one is, deliberately);
 * publishing it would offer the client a control for a provider that select_agent's
 * enum rejects, which is a worse failure than the ladder simply not being there yet.
 *
 * Returns null when no selectable provider has a ladder, so the field can be omitted
 * entirely and an older client sees exactly the payload it saw before.
 */
export function buildIntelligenceDiscovery() {
    if (_discoveryCache !== null) return _discoveryCache;

    const selectable = new Set(config.agentProviders);
    const byProvider = {};
    for (const provider of Object.keys(config.agentIntelligence?.providers ?? {})) {
        if (!selectable.has(provider)) continue;

        const ladder = getLadder(provider);
        if (!ladder) continue;

        const baselineId = getDefaultLevelId(provider);
        const baselineModel = ladder.find(l => l.id === baselineId)?.model;

        byProvider[provider] = ladder.map(level => {
            const relativeCost = deriveRelativeCost(provider, level, baselineModel);
            return {
                id: level.id,
                label: level.label ?? titleCase(level.id),
                ...(level.description ? { description: level.description } : {}),
                ...(relativeCost !== undefined ? { relativeCost } : {})
            };
        });
    }

    _discoveryCache = Object.keys(byProvider).length > 0
        ? { default: config.agentIntelligence?.defaultLevel ?? null, byProvider }
        : null;
    return _discoveryCache;
}
