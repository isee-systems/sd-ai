import dataForge from "data-forge";

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import chalk from "chalk";
import prompts from "prompts";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { printTable, uniqueFileId } from "./helpers.js";
import {
  BASELINE_TOKEN_USAGE,
  TOKENS_PER_MINUTE,
  REQUESTS_PER_MINUTE,
} from "./runHelpers.js";
import {
  buildTests,
  runExperiment,
  inProgressFileSuffix,
} from "./experimentRunner.js";

import "dotenv/config";

const argv = yargs(hideBin(process.argv))
  .option("experiment", {
    alias: "e",
    type: "string",
    description: "Experiment configuration file to use",
    demandOption: true,
  })
  .help().argv;

const experiment = JSON.parse(fs.readFileSync(argv.experiment, "utf8"));
const experimentName = path
  .basename(path.resolve(argv.experiment))
  .split(".")[0];

if (experiment.verbose === false || experiment.verbose === undefined) {
  experiment.verbose = 0;
} else if (experiment.verbose === true) {
  experiment.verbose = 2;
}

const files = fs.readdirSync(".");
const matchingFiles = files.filter((file) =>
  file.includes(`${experimentName}${inProgressFileSuffix}`)
);

let previousResults = [];
let isContinuing = false;
let experimentResultsName;

if (matchingFiles.length > 0) {
  const response = await prompts({
    type: "toggle",
    name: "resume",
    message:
      "Do you want to resume previous evaluation run? Selecting no will discard previous in progress results.",
    initial: true,
    active: "yes",
    inactive: "no",
  });
  isContinuing = response.resume;
  if (isContinuing && matchingFiles.length > 1) {
    console.log(
      chalk.red(
        chalk.bold(
          "Found multiple in progress experiment runs. Please delete all files you don't wish to resume from."
        )
      )
    );
    matchingFiles.forEach((f) => {
      console.log("- " + f);
    });
    process.exit(1);
  }
  if (!isContinuing) {
    matchingFiles.forEach((f) => {
      fs.unlinkSync(f);
    });
  }
}

if (isContinuing) {
  const previousFileName = matchingFiles[0];
  previousResults = fs
    .readFileSync(previousFileName, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  experimentResultsName = previousFileName.replace(inProgressFileSuffix, "");
} else {
  const experimentId = uniqueFileId();
  experimentResultsName = `${experimentId}_${experimentName}`;
}

const tests = await buildTests(experiment);

console.log(chalk.blue("Experiment Configuration:"));
console.log("Experiment Name: " + experimentResultsName);
if (isContinuing) {
  console.log(
    `  will attempt to use ${previousResults.length} previously saved test results`
  );
}
console.log("Sequential: " + (experiment.sequential || "false"));
console.log("Verbose: " + experiment.verbose);
console.log("Break on Error: " + experiment.breakOnError || "false");
console.log();

console.log(chalk.blue("Engine Configurations:"));
printTable(
  new dataForge.DataFrame({
    values: Object.entries(tests).map(([engineConfigName, engineTests]) => {
      return {
        engineConfigName: engineConfigName,
        engine: engineTests[0].engineConfig.engine,
        "tokensPerMinute (TPM)":
          engineTests[0].engineConfig.limits.tokensPerMinute +
          (engineTests[0].engineConfig.limits.tokensPerMinute !=
          TOKENS_PER_MINUTE
            ? "*"
            : ""),
        "requestsPerMinute (RPM)":
          engineTests[0].engineConfig.limits.requestsPerMinute +
          (engineTests[0].engineConfig.limits.requestsPerMinute !=
          REQUESTS_PER_MINUTE
            ? "*"
            : ""),
        baselineTokenUsage:
          engineTests[0].engineConfig.limits.baselineTokenUsage +
          (engineTests[0].engineConfig.limits.baselineTokenUsage !=
          BASELINE_TOKEN_USAGE
            ? "*"
            : ""),
      };
    }),
  })
);
console.log("* indicates override of default values");
console.log();
console.log();

console.log(chalk.blue("Test Configurations:"));
const exampleTest = Object.entries(tests)[0][1];
printTable(
  new dataForge.DataFrame({
    values: exampleTest,
  })
    .subset(["category", "group"])
    .pivot(["category", "group"], "prompt", (series) => series.count())
    .renameSeries({
      prompt: "# tests",
    })
);

console.log();

console.log("Press enter to run this experiment...");

if (process.platform === "win32") {
  spawnSync("pause", { shell: true, stdio: [0, 1, 2] });
} else {
  spawnSync("read _", { shell: true, stdio: [0, 1, 2] });
}

await runExperiment(experiment, tests, experimentResultsName, {
  previousResults,
});
