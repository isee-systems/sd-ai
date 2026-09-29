/**
 * Re-grade a published leaderboard's stored responses against the current evals.
 *
 * When a grader, classifier, simulator or XMILE conversion is fixed, the responses already
 * published are still the right answers to the same questions; only their verdicts are stale.
 * This passes each row's stored `generatedResponse` back through its category's current
 * `evaluate()` and writes the new verdict in place, keeping everything the engine produced
 * (response, cost, duration, generation). No engine is called.
 *
 * v1 rows are never re-graded: they are the original benchmark's record.
 *
 * A row is re-graded only when its test still asks the engine exactly what it asked when the
 * row was produced (same prompt, input model and additional parameters). Anything else needs
 * a re-run, and is listed rather than touched. Categories graded by an LLM judge are skipped
 * unless --allow-llm-judge is given, since re-grading them spends AI calls.
 *
 *   npm run evals:regrade -- --leaderboard sfd --categories physicalLaws behavioralPattern
 *
 * Like evals:collect, it shows the change and asks before writing. Use --yes in a script.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Eval output belongs to this script's report; the engine and utility logger stays quiet.
process.env.SDAI_TEST_MODE = 'true';
// An LLM-judged category's judge needs the provider keys, which live in .env as for evals:run.
await import('dotenv/config');

const chalk = (await import('chalk')).default;
const prompts = (await import('prompts')).default;
const yargs = (await import('yargs')).default;
const { hideBin } = await import('yargs/helpers');

const { LEADERBOARD_MODES, leaderboardResultsFilename, generationOf, DEFAULT_GENERATION } = await import('./leaderboardGenerations.js');
const { leaderboardResultsPath, readLeaderboardFile, writeLeaderboardFile } = await import('./leaderboardFile.js');
const { summarizeByConfig } = await import('./collectHelpers.js');
const { findCurrentTest, regradeEligibility, categoryUsesLlmJudge, regradeRow } = await import('./regradeHelpers.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = yargs(hideBin(process.argv))
    .usage('$0 --leaderboard <board> [--categories <category...>]')
    .option('leaderboard', {
        alias: 'l',
        type: 'string',
        choices: LEADERBOARD_MODES,
        description: 'Which leaderboard to re-grade',
        demandOption: true,
    })
    .option('categories', {
        alias: 'c',
        type: 'array',
        description: 'Only these categories (default: every category on the board)',
    })
    .option('generation', {
        alias: 'g',
        type: 'string',
        description: 'Only rows from this generation (e.g. v2)',
    })
    .option('allow-llm-judge', {
        type: 'boolean',
        default: false,
        description: 'Also re-grade categories graded by an LLM judge (spends AI calls)',
    })
    .option('failing-only', {
        type: 'boolean',
        default: false,
        description: 'Only re-grade rows that currently fail (after a grader was relaxed; avoids re-judging passing rows)',
    })
    .option('concurrency', {
        type: 'number',
        default: 4,
        description: 'How many rows to grade at once',
    })
    .option('dry-run', {
        type: 'boolean',
        default: false,
        description: 'Report what would change and write nothing',
    })
    .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt',
    })
    .strict()
    .help().argv;

const targetName = leaderboardResultsFilename(argv.leaderboard);
const targetPath = leaderboardResultsPath(argv.leaderboard);
if (!fs.existsSync(targetPath)) {
    console.error(chalk.red(`No published leaderboard at ${targetPath}`));
    process.exit(1);
}

const data = readLeaderboardFile(targetPath);
const rows = data.results ?? [];
console.log(`Read ${chalk.bold(targetName)}: ${rows.length} results`);

/* ------------------------------------------------------------ pick categories */

const onBoard = [...new Set(rows.map((r) => r.category))].sort();
const requested = argv.categories ? argv.categories.map(String) : onBoard;
const unknown = requested.filter((c) => !onBoard.includes(c));
if (unknown.length > 0) {
    console.error(chalk.red(`Not on the ${argv.leaderboard} leaderboard: ${unknown.join(', ')}`));
    process.exit(1);
}

const categories = new Map();
for (const category of requested) {
    const categoryPath = path.join(__dirname, 'categories', `${category}.js`);
    if (!fs.existsSync(categoryPath)) {
        console.log(chalk.yellow(`  skip ${category}: no category module`));
        continue;
    }
    if (categoryUsesLlmJudge(categoryPath) && !argv.allowLlmJudge) {
        console.log(chalk.yellow(`  skip ${category}: graded by an LLM judge (pass --allow-llm-judge to include)`));
        continue;
    }
    categories.set(category, await import(pathToFileURL(categoryPath).href));
}

/* --------------------------------------------------------------------- grade */

const regradedAt = new Date().toISOString().slice(0, 10);
const updated = rows.slice();
const flips = [];
const detailOnly = [];
const needsRerun = new Map();
const errors = [];
let graded = 0;
let v1Skipped = 0;

const work = [];
rows.forEach((row, index) => {
    const module = categories.get(row.category);
    if (!module) return;
    // v1 results are the original benchmark's record and are never rewritten, even where a
    // later grader fix would change them; the site already flags v1 numbers as indicative.
    if (generationOf(row) === DEFAULT_GENERATION) {
        v1Skipped++;
        return;
    }
    if (argv.generation && generationOf(row) !== argv.generation) return;
    if (argv.failingOnly && row.pass) return;
    const currentTest = findCurrentTest(module.groups, row);
    const eligibility = regradeEligibility(row, currentTest);
    if (!eligibility.ok) {
        const key = `${row.category} | ${row.name}: ${eligibility.reason}`;
        needsRerun.set(key, (needsRerun.get(key) || 0) + 1);
        return;
    }
    work.push({ row, index, currentTest, evaluate: module.evaluate });
});

console.log(`Grading ${work.length} rows across ${categories.size} categories...`);
let next = 0;
const worker = async () => {
    while (next < work.length) {
        const { row, index, currentTest, evaluate } = work[next++];
        try {
            const result = await regradeRow(row, currentTest, evaluate, regradedAt);
            graded++;
            if (!result.changed) continue;
            updated[index] = result.row;
            if (Boolean(row.pass) !== result.row.pass) {
                flips.push(`${generationOf(row)} ${row.engineConfigName} | ${row.category} | ${row.name}: ${row.pass ? 'pass -> FAIL' : 'fail -> pass'}`);
            } else {
                detailOnly.push(`${row.engineConfigName} | ${row.name}`);
            }
        } catch (err) {
            errors.push(`${row.engineConfigName} | ${row.name}: ${err.message}`);
        }
    }
};
await Promise.all(Array.from({ length: Math.max(1, argv.concurrency) }, worker));

/* -------------------------------------------------------------------- report */

console.log();
console.log(chalk.blue('Changes:'));
console.log(`  graded                  ${graded}`);
console.log(`  verdict flipped         ${flips.length}`);
console.log(`  failure details only    ${detailOnly.length}`);
console.log(`  not re-gradable         ${[...needsRerun.values()].reduce((a, b) => a + b, 0)}`);
console.log(`  v1 rows (never touched) ${v1Skipped}`);
console.log(`  errors (left as is)     ${errors.length}`);
for (const flip of flips.sort()) console.log(`    ${flip.includes('FAIL') ? chalk.red(flip) : chalk.green(flip)}`);
if (needsRerun.size > 0) {
    console.log(chalk.yellow('Not re-graded (rows):'));
    for (const [key, n] of [...needsRerun.entries()].sort()) console.log(`    ${n}  ${key}`);
}
for (const error of errors) console.log(chalk.red(`    ${error}`));

if (flips.length > 0) {
    console.log();
    console.log(chalk.blue('Score changes:'));
    const before = summarizeByConfig(rows);
    const after = summarizeByConfig(updated);
    for (const [name, entry] of [...after.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const old = before.get(name);
        if (!old || old.passes === entry.passes) continue;
        const pct = (e) => (100 * e.passes / e.tests).toFixed(1);
        console.log(`  ${name.padEnd(40)} ${pct(old).padStart(5)}% -> ${pct(entry).padStart(5)}%`);
    }
}

/* --------------------------------------------------------------------- write */

if (flips.length === 0 && detailOnly.length === 0) {
    console.log();
    console.log('Nothing to write.');
    process.exit(0);
}

if (argv.dryRun) {
    console.log();
    console.log(chalk.yellow('--dry-run: nothing written'));
    process.exit(0);
}

if (!argv.yes) {
    console.log();
    const { confirmed } = await prompts({
        type: 'confirm',
        name: 'confirmed',
        message: `Write ${flips.length + detailOnly.length} re-graded rows to evals/results/${targetName}?`,
        initial: true,
    });
    // prompts returns {} when the user interrupts, which must not read as approval.
    if (!confirmed) {
        console.log(chalk.yellow('Aborted, nothing written'));
        process.exit(1);
    }
}

writeLeaderboardFile(targetPath, { ...data, results: updated });
console.log(chalk.green(`Wrote evals/results/${targetName}`));
