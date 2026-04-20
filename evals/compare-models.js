import dataForge from "data-forge";
import fs from "fs";
import path from "path";

import chalk from "chalk";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { printTable, pivotAndUnstack } from "./helpers.js";

const argv = yargs(hideBin(process.argv))
  .usage("Usage: node evals/compare-models.js <results-file> [results-file ...]")
  .option("engine", {
    alias: "e",
    type: "string",
    description: "Filter to a specific engine (e.g. qualitative)",
  })
  .option("category", {
    alias: "cat",
    type: "string",
    description: "Filter to a specific category (e.g. conformance)",
  })
  .help().argv;

const files = argv._;

if (files.length === 0) {
  console.error(chalk.red("Error: provide at least one _full_results.json file as an argument"));
  process.exit(1);
}

// Load all result files
const allRows = [];

for (const filePath of files) {
  if (!fs.existsSync(filePath)) {
    console.warn(chalk.yellow(`Warning: file not found, skipping: ${filePath}`));
    continue;
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const results = raw.results ?? [];
  const meta = raw.runMetadata ?? null;

  for (const r of results) {
    // Derive display label from runMetadata if available, else parse engineConfigName
    let model, variation, engine;

    if (meta?.modelProfile?.alias) {
      model = meta.modelProfile.alias;
      const ctx = meta.contextLoaded ? `-ctx${Math.round(meta.contextLoaded / 1000)}k` : "";
      const paramParts = [];
      if (meta.variation?.temperature !== undefined) paramParts.push(`t${meta.variation.temperature}`);
      if (meta.variation?.top_p !== undefined) paramParts.push(`p${meta.variation.top_p}`);
      if (meta.variation?.top_k !== undefined && meta.variation.top_k !== -1) paramParts.push(`k${meta.variation.top_k}`);
      variation = `${ctx.slice(1)}${ctx && paramParts.length ? "-" : ""}${paramParts.join("-")}` || "default";
      // Engine is first segment of engineConfigName
      engine = r.engineConfigName?.split("-")[0] ?? "unknown";
    } else {
      // Fall back to parsing engineConfigName: {engine}-{model}-{params}
      const parts = r.engineConfigName?.split("-") ?? [];
      engine = parts[0] ?? "unknown";
      model = parts.slice(1, -1).join("-") || r.engineConfigName;
      variation = parts[parts.length - 1] ?? "default";
    }

    if (argv.engine && engine !== argv.engine) continue;
    if (argv.category && r.category !== argv.category) continue;

    allRows.push({
      model,
      backend: meta?.inferenceBackend ?? "—",
      variation,
      engine,
      category: r.category,
      pass: r.pass ? 1 : 0,
    });
  }
}

if (allRows.length === 0) {
  console.log(chalk.yellow("No results matched the given filters."));
  process.exit(0);
}

const df = new dataForge.DataFrame({ values: allRows });

// Unique engines in data (for per-engine breakdown)
const engines = [...new Set(allRows.map((r) => r.engine))].sort();
const categories = [...new Set(allRows.map((r) => r.category))].sort();

console.log();
console.log(chalk.blue(chalk.bold("=== Cross-Model Comparison ===")));
console.log(`Files: ${files.length}  |  Engines: ${engines.join(", ")}  |  Categories: ${categories.join(", ")}`);
console.log();

for (const eng of engines) {
  const engineRows = allRows.filter((r) => r.engine === eng);
  if (engineRows.length === 0) continue;

  // Group by model+variation, category -> pass rate
  const grouped = {};
  for (const row of engineRows) {
    const key = `${row.model} / ${row.backend} / ${row.variation}`;
    if (!grouped[key]) grouped[key] = {};
    if (!grouped[key][row.category]) grouped[key][row.category] = { sum: 0, count: 0 };
    grouped[key][row.category].sum += row.pass;
    grouped[key][row.category].count += 1;
  }

  const tableRows = Object.entries(grouped).map(([label, cats]) => {
    const row = { "model / backend / variation": label };
    for (const cat of categories) {
      const stats = cats[cat];
      row[cat] = stats ? `${Math.round((stats.sum / stats.count) * 100)}%` : "—";
    }
    return row;
  });

  console.log(chalk.cyan(`Engine: ${eng}`));
  printTable(new dataForge.DataFrame({ values: tableRows }));
  console.log();
}
