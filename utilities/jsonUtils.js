/**
 * Attempts to extract a valid JSON object from free-form text.
 * Tries (in order): last ```json``` code block, last top-level { } object.
 * Returns the parsed object, or null if nothing valid is found.
 */
export function extractJsonFromContent(text) {
    if (!text) return null;

    // Strategy 1: last ```json ... ``` code block
    const codeBlocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
    for (const [, block] of codeBlocks.reverse()) {
        try { return JSON.parse(block.trim()); } catch {}
    }

    // Strategy 2: scan for last complete top-level { ... } object
    const lastBrace = text.lastIndexOf('{');
    if (lastBrace !== -1) {
        let depth = 0, end = -1;
        for (let i = lastBrace; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end !== -1) {
            try { return JSON.parse(text.slice(lastBrace, end + 1)); } catch {}
        }
    }

    return null;
}
