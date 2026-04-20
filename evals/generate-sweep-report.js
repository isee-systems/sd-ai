/**
 * Generate a markdown report comparing a parameter sweep against the leaderboard.
 *
 * Usage:
 *   node evals/generate-sweep-report.js --results "<glob>" --leaderboard CLD --output report.md
 *
 * The glob should match the _full_results.json files from the sweep.
 */

import fs from "fs";
import path from "path";
import { glob } from "glob";
import chalk from "chalk";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const argv = yargs(hideBin(process.argv))
  .option("results", {
    alias: "r",
    type: "string",
    description: "Glob matching sweep result files",
    demandOption: true,
  })
  .option("leaderboard", {
    alias: "l",
    type: "string",
    description: "Leaderboard name (CLD, SFD, Discussion)",
    default: "CLD",
  })
  .option("output", {
    alias: "o",
    type: "string",
    description: "Output markdown file path",
    default: `private-notes/sweep-report-${Date.now()}.md`,
  })
  .help().argv;

// ── helpers ──────────────────────────────────────────────────────────────────

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

const CATEGORIES = [
  "conformance",
  "qualitativeTranslation",
  "qualitativeCausalReasoning",
  "qualitativeIteration",
];

const CAT_LABELS = {
  conformance: "Conform.",
  qualitativeTranslation: "Translat.",
  qualitativeCausalReasoning: "Causal",
  qualitativeIteration: "Iteration",
};

function computePassRates(results) {
  const grouped = {};
  for (const r of results) {
    const key = r.engineConfigName;
    if (!grouped[key])
      grouped[key] = { pass: 0, total: 0, byCat: {}, engineType: getEngineType(key) };
    grouped[key].total++;
    if (r.pass) grouped[key].pass++;
    const cat = r.category;
    if (!grouped[key].byCat[cat]) grouped[key].byCat[cat] = { pass: 0, total: 0 };
    grouped[key].byCat[cat].total++;
    if (r.pass) grouped[key].byCat[cat].pass++;
  }
  return grouped;
}

function pct(n, d) {
  if (!d) return "—";
  return Math.round((n / d) * 100) + "%";
}

function mdTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? "—").length))
  );
  const pad = (s, w) => String(s ?? "—").padEnd(w);
  const line = widths.map((w) => "-".repeat(w)).join(" | ");
  const head = headers.map((h, i) => pad(h, widths[i])).join(" | ");
  const body = rows.map((r) => r.map((c, i) => pad(c, widths[i])).join(" | "));
  return ["| " + head + " |", "| " + line + " |", ...body.map((r) => "| " + r + " |")].join(
    "\n"
  );
}

// ── load sweep files ──────────────────────────────────────────────────────────

const sweepFiles = (await glob(argv.results, { cwd: process.cwd() })).sort();

if (sweepFiles.length === 0) {
  console.error(chalk.red(`No sweep result files matched: ${argv.results}`));
  process.exit(1);
}

console.log(chalk.blue(`Found ${sweepFiles.length} sweep result file(s)`));

const sweepRuns = [];

for (const filePath of sweepFiles) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const results = raw.results ?? [];
  const meta = raw.runMetadata ?? null;

  let label, paramSuffix, modelAlias;
  if (meta?.modelProfile?.alias) {
    modelAlias = meta.modelProfile.alias;
    const v = meta.variation ?? {};
    const seed = meta.seed;
    const parts = [];
    if (v.temperature !== undefined) parts.push(`temp=${v.temperature}`);
    if (v.top_p !== undefined) parts.push(`top_p=${v.top_p}`);
    if (v.top_k !== undefined && v.top_k !== -1) parts.push(`top_k=${v.top_k}`);
    else parts.push("top_k=default");
    if (seed !== undefined) parts.push(`seed=${seed}`);
    paramSuffix = parts.join(", ");
    label = paramSuffix;
  } else {
    modelAlias = path.basename(filePath).split("_").slice(1, 3).join("_");
    label = path.basename(filePath).replace("_full_results.json", "");
    paramSuffix = label;
  }

  const passRates = computePassRates(results);
  sweepRuns.push({ filePath, label, modelAlias, meta, passRates, results });
}

// ── load leaderboard ──────────────────────────────────────────────────────────

const leaderboardPath = `evals/results/leaderboard_${argv.leaderboard.toLowerCase()}_full_results.json`;
const leaderboardRaw = JSON.parse(fs.readFileSync(leaderboardPath, "utf-8"));
const leaderboardPassRates = computePassRates(leaderboardRaw.results ?? []);

// ── build report ─────────────────────────────────────────────────────────────

const modelAlias = sweepRuns[0]?.modelAlias ?? "Unknown Model";
const leaderboard = argv.leaderboard.toUpperCase();
const runDate = new Date().toISOString().split("T")[0];

const lines = [];

lines.push(`# ${modelAlias} — Parameter Sweep Report`);
lines.push(`**Benchmark:** ${leaderboard}  |  **Date:** ${runDate}  |  **Seed:** ${sweepRuns[0]?.meta?.seed ?? "n/a"}`);
lines.push("");

// Model profile info
if (sweepRuns[0]?.meta?.modelProfile) {
  const mp = sweepRuns[0].meta.modelProfile;
  lines.push("## Model");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Alias | ${mp.alias} |`);
  lines.push(`| LM Studio ID | \`${mp.lmStudioModelId}\` |`);
  lines.push(`| Quantization | ${mp.quantization ?? "n/a"} |`);
  lines.push(`| Parameters | ${mp.parameterCount ?? "n/a"} |`);
  if (mp.notes) lines.push(`| Notes | ${mp.notes} |`);
  lines.push("");
}

// ── Section 1: sweep results by engine type ──────────────────────────────────

lines.push("## Parameter Sweep Results");
lines.push("");

const engineTypes = [...new Set(
  sweepRuns.flatMap(({ passRates }) => Object.values(passRates).map((v) => v.engineType))
)].sort();

for (const engineType of engineTypes) {
  lines.push(`### Engine: \`${engineType}\``);
  lines.push("");

  const headers = ["Parameters", ...CATEGORIES.map((c) => CAT_LABELS[c]), "Overall"];
  const rows = [];

  for (const run of sweepRuns) {
    const configEntry = Object.entries(run.passRates).find(
      ([, v]) => v.engineType === engineType
    );
    if (!configEntry) continue;
    const [, d] = configEntry;
    rows.push([
      run.label,
      ...CATEGORIES.map((c) => pct(d.byCat[c]?.pass, d.byCat[c]?.total)),
      pct(d.pass, d.total),
    ]);
  }

  if (rows.length > 0) {
    lines.push(mdTable(headers, rows));
    lines.push("");
  }
}

// ── Section 2: comparison against leaderboard ────────────────────────────────

lines.push("## Comparison Against Leaderboard");
lines.push("");
lines.push("Best sweep result per engine type vs top leaderboard models.");
lines.push("");

for (const engineType of engineTypes) {
  lines.push(`### \`${engineType}\``);
  lines.push("");

  // Best sweep run for this engine type (by overall pass rate)
  const sweepEntries = sweepRuns.flatMap(({ label, passRates }) => {
    const entry = Object.entries(passRates).find(([, v]) => v.engineType === engineType);
    return entry ? [{ label, data: entry[1] }] : [];
  });

  if (sweepEntries.length === 0) continue;
  const bestSweep = sweepEntries.reduce((best, cur) =>
    cur.data.pass / cur.data.total > best.data.pass / best.data.total ? cur : best
  );

  // Top leaderboard entries for same engine type (by overall)
  const lbEntries = Object.entries(leaderboardPassRates)
    .filter(([name, v]) => v.engineType === engineType)
    .map(([name, d]) => ({ name, data: d, overall: d.pass / d.total }))
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 5);

  const headers = ["Model / Config", ...CATEGORIES.map((c) => CAT_LABELS[c]), "Overall"];
  const rows = [];

  // Insert best sweep run first with marker
  const bd = bestSweep.data;
  rows.push([
    `**${modelAlias}** (${bestSweep.label}) ★`,
    ...CATEGORIES.map((c) => pct(bd.byCat[c]?.pass, bd.byCat[c]?.total)),
    pct(bd.pass, bd.total),
  ]);

  for (const { name, data: d } of lbEntries) {
    const shortName = name.replace(`${engineType}-`, "");
    rows.push([
      shortName,
      ...CATEGORIES.map((c) => pct(d.byCat[c]?.pass, d.byCat[c]?.total)),
      pct(d.pass, d.total),
    ]);
  }

  lines.push(mdTable(headers, rows));
  lines.push("");
}

// ── Section 3: parameter sensitivity analysis ─────────────────────────────────

lines.push("## Parameter Sensitivity");
lines.push("");
lines.push("Pass rate across all engines for each parameter variation.");
lines.push("");

const sensitivityHeaders = ["Parameters", ...CATEGORIES.map((c) => CAT_LABELS[c]), "Overall"];
const sensitivityRows = sweepRuns.map((run) => {
  const allResults = run.results;
  const grouped = {};
  for (const r of allResults) {
    grouped[r.category] = grouped[r.category] ?? { pass: 0, total: 0 };
    grouped[r.category].total++;
    if (r.pass) grouped[r.category].pass++;
  }
  const overall = { pass: allResults.filter((r) => r.pass).length, total: allResults.length };
  return [
    run.label,
    ...CATEGORIES.map((c) => pct(grouped[c]?.pass, grouped[c]?.total)),
    pct(overall.pass, overall.total),
  ];
});

lines.push(mdTable(sensitivityHeaders, sensitivityRows));
lines.push("");

// Identify best and worst
const rankedRuns = sweepRuns
  .map((run) => ({
    label: run.label,
    overall: run.results.filter((r) => r.pass).length / run.results.length,
  }))
  .sort((a, b) => b.overall - a.overall);

lines.push(`**Best variation:** ${rankedRuns[0].label} (${Math.round(rankedRuns[0].overall * 100)}% overall)`);
lines.push(`**Worst variation:** ${rankedRuns[rankedRuns.length - 1].label} (${Math.round(rankedRuns[rankedRuns.length - 1].overall * 100)}% overall)`);
lines.push("");

// ── Section 4: observations ───────────────────────────────────────────────────

lines.push("## Observations");
lines.push("");

// Causal reasoning gap
const causalRates = sweepRuns.map((run) => {
  const cat = run.results.filter((r) => r.category === "qualitativeCausalReasoning");
  return { label: run.label, rate: cat.length ? cat.filter((r) => r.pass).length / cat.length : 0 };
});
const avgCausal = causalRates.reduce((s, r) => s + r.rate, 0) / causalRates.length;

// Top cloud model for comparison
const topCloud = Object.entries(leaderboardPassRates)
  .map(([name, d]) => ({ name, overall: d.pass / d.total }))
  .sort((a, b) => b.overall - a.overall)[0];

lines.push(`- **vs top leaderboard model (${topCloud.name}):** ${topCloud.name.replace(/^.*-/, "")} achieves ${Math.round(topCloud.overall * 100)}% overall on ${leaderboard}.`);
lines.push(`- **Causal reasoning:** Average ${Math.round(avgCausal * 100)}% across all variations — this is a known weakness for local models at this quant level.`);
lines.push(`- **Temperature sensitivity:** Compare temp=0 vs temp=1 rows to assess variability impact.`);
lines.push(`- **top_k impact:** Variations with explicit top_k vs default show differences in translation/conformance tradeoff.`);
lines.push("");

// ── write file ────────────────────────────────────────────────────────────────

const outputDir = path.dirname(argv.output);
if (outputDir && !fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

fs.writeFileSync(argv.output, lines.join("\n") + "\n");
console.log(chalk.green(`\nReport written to: ${chalk.bold(argv.output)}`));
console.log(chalk.blue(`Covered ${sweepFiles.length} sweep file(s) vs ${Object.keys(leaderboardPassRates).length} leaderboard configs`));
