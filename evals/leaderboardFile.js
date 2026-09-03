/**
 * Where a published leaderboard lives on disk, and how to read and write it.
 *
 * The files are gzipped. They are the accumulation of every eval round ever published,
 * so they only grow: the discussion board is already ~47 MB of JSON and was heading for
 * GitHub's 100 MB per-file limit, which would have taken the whole repo with it. Nothing
 * reads them by eye and every reader goes through here, so the compression costs a
 * gunzip (~100 ms) and buys about 4x.
 *
 * Run files — the `<id>_<experiment>_full_results.json` an eval execution drops in the
 * project root — are NOT gzipped. They are transient, they are inspected by hand and
 * with `jq`, and they are one execution rather than a growing archive. Only the
 * published boards under `evals/results/` are compressed, and this module is the only
 * place that knows it.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

import { leaderboardResultsFilename } from './leaderboardGenerations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The directory holding the published leaderboard files. */
export const LEADERBOARD_RESULTS_DIR = path.join(__dirname, 'results');

/** Absolute path to one board's published results file. */
export function leaderboardResultsPath(mode) {
    return path.join(LEADERBOARD_RESULTS_DIR, leaderboardResultsFilename(mode));
}

/**
 * Read and parse a published leaderboard.
 *
 * Synchronous on purpose: every caller — the API route, the collect CLI, the site
 * generator — needs the whole thing parsed before it can do anything, so there is no
 * work to overlap with the read.
 */
export function readLeaderboardFile(filePath) {
    let json;
    try {
        json = zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8');
    } catch (err) {
        // Left uncompressed by hand, or truncated. gunzip's own message ("incorrect
        // header check") does not say which file or what was expected of it.
        throw new Error(`${filePath}: could not be read as gzip — ${err.message}`);
    }
    return JSON.parse(json);
}

/**
 * Write a published leaderboard.
 *
 * Minified and at maximum compression: these are written once per collect and then
 * committed for good, so a couple of seconds of CPU is worth the smaller permanent
 * object in git history.
 */
export function writeLeaderboardFile(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, zlib.gzipSync(Buffer.from(JSON.stringify(data), 'utf8'), { level: 9 }));
}
