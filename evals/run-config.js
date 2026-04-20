import dataForge from "data-forge";

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import chalk from "chalk";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { printTable, uniqueFileId } from "./helpers.js";
import { buildTests, runExperiment } from "./experimentRunner.js";
import { ensureModelLoaded } from "../utilities/LMStudioLoader.js";

import "dotenv/config";

const argv = yargs(hideBin(process.argv))
  .option("run-config", {
    alias: "c",
    type: "string",
    description: "Run configuration file to use",
    demandOption: true,
  })
  .option("yes", {
    alias: "y",
    type: "boolean",
    description: "Skip confirmation prompt and start immediately",
    default: false,
  })
  .option("retry-from", {
    alias: "r",
    type: "string",
    description: "Results file to retry failures from — passes are skipped, failures are re-run",
  })
  .option("errors-only", {
    type: "boolean",
    description: "With --retry-from: only re-run error responses (bad JSON, timeouts), skip eval failures",
    default: false,
  })
  .help().argv;

const runConfig = JSON.parse(fs.readFileSync(argv.runConfig, "utf8"));

const modelProfile = JSON.parse(
  fs.readFileSync(runConfig.modelProfile, "utf8")
);

const baseExperimentPath = runConfig.baseExperiment;
const baseExperiment = JSON.parse(fs.readFileSync(baseExperimentPath, "utf8"));
const baseExperimentName = path
  .basename(path.resolve(baseExperimentPath))
  .split(".")[0];

function buildParamSuffix(variation, seed) {
  const parts = [];
  if (variation.temperature !== undefined) parts.push(`t${variation.temperature}`);
  if (variation.top_p !== undefined) parts.push(`p${variation.top_p}`);
  if (variation.top_k !== undefined && variation.top_k !== -1)
    parts.push(`k${variation.top_k}`);
  if (seed !== undefined) parts.push(`seed${seed}`);
  return parts.join("-");
}

function contextTag(profile) {
  if (!profile.contextLoaded) return "";
  return `-ctx${Math.round(profile.contextLoaded / 1000)}k`;
}

async function buildCategories(baseCategories) {
  // categoryOverrides: replace category filters entirely (empty array = skip category)
  if (runConfig.categoryOverrides) {
    const overrides = runConfig.categoryOverrides;
    const entries = Object.entries(baseCategories).map(([cat]) => {
      const override = overrides[cat];
      if (override === undefined) return [cat, baseCategories[cat]];
      if (Array.isArray(override) && override.length === 0) return null;
      console.log(`  ${cat}: override — keeping [${override.join(', ')}]`);
      return [cat, override];
    }).filter(Boolean);
    return Object.fromEntries(entries);
  }

  const excludeGroups = runConfig.excludeGroups ?? [];
  const includeGroups = runConfig.includeGroups ?? [];

  if (excludeGroups.length === 0 && includeGroups.length === 0) return baseCategories;

  const entries = await Promise.all(
    Object.entries(baseCategories).map(async ([cat, filter]) => {
      if (filter !== true) return [cat, filter];
      const { groups } = await import(`./categories/${cat}.js`);
      let allowedGroups = Object.keys(groups);
      if (includeGroups.length > 0) {
        allowedGroups = allowedGroups.filter(g => includeGroups.includes(g));
      }
      if (excludeGroups.length > 0) {
        allowedGroups = allowedGroups.filter(g => !excludeGroups.includes(g));
      }
      if (allowedGroups.length === 0) return null; // skip category entirely
      console.log(`  ${cat}: keeping [${allowedGroups.join(', ')}]`);
      return [cat, allowedGroups];
    })
  );
  return Object.fromEntries(entries.filter(Boolean));
}

async function buildVariationExperiment(variation) {
  const verbose = runConfig.verbose;
  const normalizedVerbose =
    verbose === false || verbose === undefined
      ? 0
      : verbose === true
      ? 2
      : verbose;

  const paramSuffix = buildParamSuffix(variation, runConfig.seed);
  const engineConfigs = {};

  for (const engineSpec of runConfig.engines) {
    const engineName =
      typeof engineSpec === "string" ? engineSpec : engineSpec.name;
    const engineLimits =
      typeof engineSpec === "object" ? engineSpec.limits : undefined;
    const engineAdditionalParams =
      typeof engineSpec === "object"
        ? engineSpec.additionalParameters
        : undefined;

    const configName = `${engineName}-${modelProfile.alias}${contextTag(modelProfile)}-${paramSuffix}`;

    const additionalParameters = {
      underlyingModel: modelProfile.lmStudioModelId,
      ...(modelProfile.baseURL && { baseURL: modelProfile.baseURL }),
      ...(modelProfile.maxTokens !== undefined && { max_tokens: modelProfile.maxTokens }),
      ...(modelProfile.timeoutMinutes !== undefined && { timeoutMinutes: modelProfile.timeoutMinutes }),
      ...(modelProfile.lenientJsonParsing && { lenientJsonParsing: true }),
      ...(modelProfile.jsonObjectMode && { jsonObjectMode: true }),
      ...(modelProfile.lmStudioSettings?.thinkingMode === false && { thinking: false }),
      ...(modelProfile.lmStudioSettings?.structuredOutput === false && { structuredOutput: false }),
      ...(variation.temperature !== undefined && {
        temperature: variation.temperature,
      }),
      ...(variation.top_p !== undefined && { top_p: variation.top_p }),
      ...(variation.top_k !== undefined &&
        variation.top_k !== -1 && { top_k: variation.top_k }),
      ...(runConfig.seed !== undefined && { seed: runConfig.seed }),
      ...engineAdditionalParams,
    };

    engineConfigs[configName] = {
      engine: engineName,
      additionalParameters,
      ...(engineLimits && { limits: engineLimits }),
    };
  }

  return {
    concurrency: runConfig.concurrency,
    verbose: normalizedVerbose,
    sequential: false,
    engineConfigs,
    categories: await buildCategories(baseExperiment.categories),
  };
}

function updateLeaderboard(leaderboardName, newResponses) {
  const leaderboardPath = `evals/results/leaderboard_${leaderboardName.toLowerCase()}_full_results.json`;

  let existingResponses = [];
  if (fs.existsSync(leaderboardPath)) {
    const existing = JSON.parse(fs.readFileSync(leaderboardPath, "utf-8"));
    existingResponses = existing.results || [];
  }

  const newEngineConfigNames = new Set(
    newResponses.map((r) => r.engineConfigName)
  );
  const filtered = existingResponses.filter(
    (r) => !newEngineConfigNames.has(r.engineConfigName)
  );
  const replaced = existingResponses.length - filtered.length;

  const allResults = [...filtered, ...newResponses];
  fs.writeFileSync(
    leaderboardPath,
    JSON.stringify({ results: allResults }, null, 2)
  );

  console.log(
    chalk.green(
      `Leaderboard updated: ${leaderboardPath} — replaced ${replaced}, added ${newResponses.length - replaced}, total ${allResults.length}`
    )
  );
}

// Print planned variations
console.log(chalk.blue("Run Configuration:"));
console.log(`Model: ${chalk.bold(modelProfile.alias)} (${modelProfile.quantization ?? ""}${modelProfile.parameterCount ? " " + modelProfile.parameterCount : ""})`);
if (modelProfile.contextLoaded)
  console.log(`Context: ${(modelProfile.contextLoaded / 1000).toFixed(0)}k tokens loaded  |  KV cache quant: ${modelProfile.kvCacheQuant ?? "default"}  |  Backend: ${modelProfile.inferenceBackend ?? "unknown"}`);
console.log(`Base experiment: ${baseExperimentName}`);
if (runConfig.seed !== undefined)
  console.log(`Seed: ${runConfig.seed}`);
if (runConfig.leaderboard)
  console.log(`Leaderboard: ${runConfig.leaderboard}`);
console.log();

console.log(chalk.blue(`Planned variations (${runConfig.variations.length}):`));
printTable(
  new dataForge.DataFrame({
    values: runConfig.variations.map((v, i) => ({
      "#": i + 1,
      temperature: v.temperature ?? "(default)",
      top_p: v.top_p ?? "(default)",
      top_k: v.top_k === -1 || v.top_k === undefined ? "(default)" : v.top_k,
      seed: runConfig.seed ?? "(none)",
      outputName: `${modelProfile.alias}${contextTag(modelProfile)}-${buildParamSuffix(v, runConfig.seed)}-${baseExperimentName}`,
    })),
  })
);
console.log();

if (!argv.yes) {
  console.log(
    `Press enter to start all ${runConfig.variations.length} variation(s) back-to-back...`
  );
  if (process.platform === "win32") {
    spawnSync("pause", { shell: true, stdio: [0, 1, 2] });
  } else {
    spawnSync("read _", { shell: true, stdio: [0, 1, 2] });
  }
}

// Load passing results from a prior run to skip re-running them
let retryPreviousResults = [];
if (argv.retryFrom) {
  const retryData = JSON.parse(fs.readFileSync(argv.retryFrom, "utf-8"));
  const allPrior = retryData.results ?? [];
  if (argv.errorsOnly) {
    // Skip passes AND eval failures — only re-run error responses (bad JSON, no content, etc.)
    const isError = (r) => r.generatedResponse?.err !== undefined;
    retryPreviousResults = allPrior.filter((r) => r.pass || (!r.pass && !isError(r)));
    const errorCount = allPrior.filter(isError).length;
    console.log(
      chalk.yellow(
        `Retry mode (errors only): ${errorCount} error responses will be re-run, ${retryPreviousResults.length} results skipped`
      )
    );
  } else {
    retryPreviousResults = allPrior.filter((r) => r.pass);
    console.log(
      chalk.yellow(
        `Retry mode: ${allPrior.length - retryPreviousResults.length} failures will be re-run, ${retryPreviousResults.length} passes skipped`
      )
    );
  }
  console.log();
}

// Auto-load model at the correct context length if profile specifies both
if (modelProfile.lmStudioModelId && modelProfile.contextLoaded) {
  console.log(chalk.blue('Ensuring model is loaded at correct context...'));
  try {
    await ensureModelLoaded(modelProfile.lmStudioModelId, modelProfile.contextLoaded);
  } catch (err) {
    console.warn(chalk.yellow(`  Warning: could not auto-load model via LM Studio API: ${err.message}`));
    console.warn(chalk.yellow('  Continuing — ensure model is loaded manually in LM Studio.'));
  }
  console.log();
}

const variationSummaries = [];

for (let i = 0; i < runConfig.variations.length; i++) {
  const variation = runConfig.variations[i];
  const paramSuffix = buildParamSuffix(variation, runConfig.seed);

  console.log();
  console.log(
    chalk.bold(
      chalk.cyan(
        `=== Variation ${i + 1}/${runConfig.variations.length}: ${paramSuffix} ===`
      )
    )
  );
  console.log();

  const experiment = await buildVariationExperiment(variation);
  const experimentResultsName = `${uniqueFileId()}_${modelProfile.alias}${contextTag(modelProfile)}-${paramSuffix}-${baseExperimentName}`;

  const runMetadata = {
    modelProfile,
    variation,
    seed: runConfig.seed,
    baseExperiment: baseExperimentName,
    inferenceBackend: modelProfile.inferenceBackend ?? null,
    contextLoaded: modelProfile.contextLoaded ?? null,
    kvCacheQuant: modelProfile.kvCacheQuant ?? null,
  };

  const tests = await buildTests(experiment);
  const { responses, summary } = await runExperiment(
    experiment,
    tests,
    experimentResultsName,
    { runMetadata, previousResults: retryPreviousResults }
  );

  variationSummaries.push({ paramSuffix, summary });

  if (runConfig.leaderboard) {
    updateLeaderboard(runConfig.leaderboard, responses);
  }
}

// Final comparison across all variations
if (variationSummaries.length > 1) {
  console.log();
  console.log(chalk.blue(chalk.bold("=== Parameter Sweep Summary ===")));
  console.log(`Model: ${modelProfile.alias}`);
  console.log();

  // Collect all category names across summaries
  const allCategories = [
    ...new Set(
      variationSummaries.flatMap(({ summary }) => {
        try {
          return summary
            .getColumnNames()
            .filter((c) => c !== "engineConfigName");
        } catch {
          return [];
        }
      })
    ),
  ];

  if (allCategories.length > 0) {
    const comparisonRows = variationSummaries.flatMap(({ paramSuffix, summary }) => {
      const rows = summary.toArray();
      return rows.map((row) => {
        const engineType = row.engineConfigName
          ? row.engineConfigName.split("-")[0]
          : "unknown";
        const result = { variation: paramSuffix, engine: engineType };
        allCategories.forEach((cat) => {
          result[cat] =
            row[cat] !== undefined ? `${Math.round(row[cat] * 100)}%` : "—";
        });
        return result;
      });
    });

    printTable(new dataForge.DataFrame({ values: comparisonRows }));
  }
}
