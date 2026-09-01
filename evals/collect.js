/**
 * Fold an eval run into a published leaderboard.
 *
 * `npm run evals` writes `<id>_<experiment>_full_results.json` into the project root.
 * That file is one execution; a leaderboard is the accumulation of many. This is the
 * step between them — it stamps the run with the generation it belongs to and merges
 * it into `evals/results/leaderboard_<board>_full_results.json`, appending what is new
 * and replacing what it re-ran, leaving everything else alone. A result from a newer
 * generation replaces the older one for that test; the tag records which generation
 * each surviving row came from.
 *
 *   npm run evals:collect -- --leaderboard sfd --generation v2 xnt_anthropicSFD_full_results.json
 *
 * The published files are what the public site and API serve, so the default is to
 * show the change and ask before writing. Use --yes in a script.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import chalk from "chalk";
import prompts from "prompts";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  LEADERBOARD_MODES,
  LEADERBOARD_GENERATIONS,
  leaderboardResultsFilename,
  findGeneration,
  generationsIn,
} from "./leaderboardGenerations.js";
import {
  mergeResults,
  stampGeneration,
  validateResults,
  summarizeByConfig,
  categoriesIn,
} from "./collectHelpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "results");

const argv = yargs(hideBin(process.argv))
  .usage("$0 --leaderboard <board> --generation <id> <run_full_results.json...>")
  .option("leaderboard", {
    alias: "l",
    type: "string",
    choices: LEADERBOARD_MODES,
    description: "Which leaderboard to publish into",
    demandOption: true,
  })
  .option("generation", {
    alias: "g",
    type: "string",
    choices: LEADERBOARD_GENERATIONS.map((g) => g.id),
    description: "Which benchmark generation these results belong to",
    demandOption: true,
  })
  .option("replace-configs", {
    type: "boolean",
    default: false,
    description:
      "Before merging, drop every existing row for each engine config in the run, whatever generation produced it. Use when the rerun is the whole truth for those configs.",
  })
  .option("dry-run", {
    type: "boolean",
    default: false,
    description: "Report what would change and write nothing",
  })
  .option("yes", {
    alias: "y",
    type: "boolean",
    default: false,
    description: "Skip the confirmation prompt",
  })
  .demandCommand(1, "Pass at least one eval run results file")
  .strict()
  .help().argv;

const generation = findGeneration(argv.generation);
const targetName = leaderboardResultsFilename(argv.leaderboard);
const targetPath = path.join(RESULTS_DIR, targetName);

/* ------------------------------------------------------------------ load runs */

const incoming = [];
for (const file of argv._) {
  const filePath = path.resolve(String(file));
  if (!fs.existsSync(filePath)) {
    console.error(chalk.red(`No such file: ${filePath}`));
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(chalk.red(`${filePath}: not valid JSON — ${err.message}`));
    process.exit(1);
  }
  try {
    validateResults(parsed.results, path.basename(filePath));
  } catch (err) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }
  console.log(`Read ${chalk.bold(path.basename(filePath))}: ${parsed.results.length} results`);
  incoming.push(...parsed.results);
}

const stamped = stampGeneration(incoming, generation.id);

/* --------------------------------------------------------------- load target */

let existing = [];
if (fs.existsSync(targetPath)) {
  const parsed = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  existing = parsed.results ?? [];
  console.log(
    `Target ${chalk.bold(targetName)}: ${existing.length} results ` +
      `(generations: ${generationsIn(existing).join(", ") || "none"})`
  );
} else {
  console.log(`Target ${chalk.bold(targetName)}: does not exist yet, will be created`);
}

// A run merged into the wrong board is easy to do and unpleasant to undo, and the
// category overlap between boards (conformance runs in both cld and sfd) means the
// names alone don't always give it away. Sharing nothing with what is already
// published is the strongest signal available here, so say so rather than guess.
if (existing.length > 0) {
  const existingCategories = categoriesIn(existing);
  const overlap = [...categoriesIn(stamped)].filter((c) => existingCategories.has(c));
  if (overlap.length === 0) {
    console.log(
      chalk.yellow(
        `\nWarning: this run shares no test categories with the existing "${argv.leaderboard}" leaderboard.\n` +
          `  run has:      ${[...categoriesIn(stamped)].join(", ")}\n` +
          `  leaderboard:  ${[...existingCategories].join(", ")}\n` +
          `  Is this the right --leaderboard?`
      )
    );
  }
}

/* --------------------------------------------------------------------- merge */

const merged = mergeResults(existing, stamped, { replaceConfigs: argv.replaceConfigs });

console.log();
console.log(chalk.blue("Changes:"));
console.log(`  added     ${merged.added}`);
console.log(`  replaced  ${merged.replaced}`);
if (argv.replaceConfigs) console.log(`  removed   ${merged.removed}  (--replace-configs)`);
console.log(`  untouched ${merged.kept}`);
console.log(`  total     ${existing.length} -> ${chalk.bold(merged.results.length)}`);

console.log();
console.log(chalk.blue("Leaderboard after this merge:"));
const summary = summarizeByConfig(merged.results);
for (const entry of [...summary.values()].sort((a, b) => a.engineConfigName.localeCompare(b.engineConfigName))) {
  const score = entry.tests > 0 ? (entry.passes / entry.tests) : 0;
  const cost = entry.hasCost ? `$${entry.cost.toFixed(4)}` : "no cost recorded";
  // A config only partly re-run holds a mix of generations, and that mix is the thing
  // an operator needs in order to know what is still on old numbers.
  const gens = Object.entries(entry.byGeneration)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, n]) => `${id}:${n}`)
    .join(" ");
  console.log(
    `  ${entry.engineConfigName.padEnd(38)} ${String(entry.tests).padStart(4)} tests  ` +
      `${(score * 100).toFixed(1).padStart(5)}% pass  ${cost.padEnd(18)} ${gens}`
  );
}

/* --------------------------------------------------------------------- write */

if (argv.dryRun) {
  console.log();
  console.log(chalk.yellow("--dry-run: nothing written"));
  process.exit(0);
}

if (!argv.yes) {
  console.log();
  const { confirmed } = await prompts({
    type: "confirm",
    name: "confirmed",
    message: `Write ${merged.results.length} results to evals/results/${targetName}?`,
    initial: true,
  });
  // prompts returns {} when the user interrupts, which must not read as approval.
  if (!confirmed) {
    console.log(chalk.yellow("Aborted, nothing written"));
    process.exit(1);
  }
}

fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.writeFileSync(targetPath, JSON.stringify({ results: merged.results }, null, 2));
console.log(chalk.green(`Wrote evals/results/${targetName}`));
console.log("Rebuild the site data to publish: cd frontend && npm run generate");
