import dataForge from "data-forge";
import fs from "fs";
import path from "path";

import { glob } from "glob";
import chalk from "chalk";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { printTable } from "./helpers.js";

const ENGINE_PREFIXES = [
  "qualitative-zero",
  "recursivecausal",
  "causal-chains",
  "quantitative-zero",
  "quantitative",
  "qualitative",
  "causal-decoder",
];

function getEngineType(configName) {
  for (const prefix of ENGINE_PREFIXES) {
    if (configName === prefix || configName.startsWith(prefix + "-")) return prefix;
  }
  return configName.split("-")[0];
}

const argv = yargs(hideBin(process.argv))
  .option("results", {
    alias: "r",
    type: "string",
    description: "Glob pattern matching result files to compare",
    demandOption: true,
  })
  .help().argv;

const files = await glob(argv.results, { cwd: process.cwd() });

if (files.length === 0) {
  console.error(chalk.red(`No files matched: ${argv.results}`));
  process.exit(1);
}

console.log(chalk.blue(`Comparing ${files.length} result file(s):\n`));
files.forEach((f) => console.log(`  ${f}`));
console.log();

const rows = [];

for (const filePath of files.sort()) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const results = raw.results ?? [];
  const runMetadata = raw.runMetadata ?? null;

  // Build run label
  let runLabel;
  if (runMetadata?.modelProfile?.alias) {
    const { alias } = runMetadata.modelProfile;
    const v = runMetadata.variation ?? {};
    const seed = runMetadata.seed;
    const parts = [];
    if (v.temperature !== undefined) parts.push(`t${v.temperature}`);
    if (v.top_p !== undefined) parts.push(`p${v.top_p}`);
    if (v.top_k !== undefined && v.top_k !== -1) parts.push(`k${v.top_k}`);
    if (seed !== undefined) parts.push(`seed${seed}`);
    runLabel = parts.length > 0 ? `${alias} ${parts.join("-")}` : alias;
  } else {
    runLabel = path.basename(filePath).replace("_full_results.json", "");
  }

  // Group results by engineType × category and compute pass rates
  const grouped = {};
  for (const result of results) {
    const engineType = getEngineType(result.engineConfigName ?? "unknown");
    const category = result.category ?? "unknown";
    const key = `${engineType}|${category}`;
    if (!grouped[key]) grouped[key] = { pass: 0, total: 0, engineType, category };
    grouped[key].total++;
    if (result.pass) grouped[key].pass++;
  }

  for (const { engineType, category, pass, total } of Object.values(grouped)) {
    rows.push({
      run: runLabel,
      engine: engineType,
      category,
      passRate: total > 0 ? pass / total : 0,
      passed: pass,
      total,
    });
  }
}

if (rows.length === 0) {
  console.log(chalk.yellow("No results found in the matched files."));
  process.exit(0);
}

// Pivot: rows = run+engine, cols = category, values = pass rate %
const df = new dataForge.DataFrame({ values: rows });

const allCategories = [...new Set(rows.map((r) => r.category))].sort();

const pivotRows = [];
const runEngineKeys = [
  ...new Set(rows.map((r) => `${r.run}|||${r.engine}`)),
];

for (const key of runEngineKeys) {
  const [run, engine] = key.split("|||");
  const entry = { run, engine };
  for (const cat of allCategories) {
    const match = rows.find((r) => r.run === run && r.engine === engine && r.category === cat);
    entry[cat] = match ? `${Math.round(match.passRate * 100)}%` : "—";
  }
  pivotRows.push(entry);
}

printTable(new dataForge.DataFrame({ values: pivotRows }));

// Write CSV with raw pass rates
const csvRows = rows.map((r) => ({
  run: r.run,
  engine: r.engine,
  category: r.category,
  passRate: (r.passRate * 100).toFixed(1),
  passed: r.passed,
  total: r.total,
}));

const csvPath = `comparison_${Date.now()}.csv`;
fs.writeFileSync(
  csvPath,
  new dataForge.DataFrame({ values: csvRows }).toCSV()
);
console.log(chalk.blue(`\nWrote comparison CSV to ${chalk.bold(csvPath)}`));
