import dataForge from "data-forge";

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import { RateLimiter } from "limiter";
import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";
const enc = new Tiktoken(o200k_base);

import cliProgress from "cli-progress";
import chalk from "chalk";
import prompts from "prompts";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { printTable, pivotAndUnstack, uniqueFileId } from "./helpers.js";

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
const experimentName = path.basename(path.resolve(argv.experiment)).split(".")[0];

// Normalize verbose flag to integer levels
// false or undefined -> 0, true -> 2, otherwise use the integer value
if (experiment.verbose === false || experiment.verbose === undefined) {
  experiment.verbose = 0;
} else if (experiment.verbose === true) {
  experiment.verbose = 2;
}

const files = fs.readdirSync('.');
const inProgressFileSuffix = "_in_progress.jsonl"
const matchingFiles = files.filter(file => file.includes(`${experimentName}${inProgressFileSuffix}`));

let previousResults = []
let isContinuing = false;
let experimentResultsName;

if (matchingFiles.length > 0) {
    const response = await prompts({
      type: 'toggle',
      name: 'resume',
      message: 'Do you want to resume previous evaluation run? Selecting no will discard previous in progress results.',
      initial: true,
      active: 'yes',
      inactive: 'no'
    });
    isContinuing = response.resume;
    if (isContinuing && matchingFiles.length > 1) {
      console.log(chalk.red(chalk.bold("Found multiple in progress experiment runs. Please delete all files you don't wish to resume from.")));
      matchingFiles.forEach(f => {
        console.log("- " + f)
      })
      process.exit(1)
    }
    if (!isContinuing) {
      matchingFiles.forEach(f => {
        fs.unlinkSync(f);
      });
    }
    console.log()
}

if (isContinuing) {
  const previousFileName = matchingFiles[0];
  previousResults = fs.readFileSync(previousFileName, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  experimentResultsName = previousFileName.replace(inProgressFileSuffix,"")
} else {
  const experimentId = uniqueFileId();
  experimentResultsName = `${experimentId}_${experimentName}`;
}


// See commentary in readme about rate limiting
// 3k was max total tokens used by causual translation on a standard non-reasoning openai model at teir 1
const BASELINE_TOKEN_USAGE = 3000;
const TOKENS_PER_MINUTE = 30_000;
// openai typically allows 500 requests per minute, so 400 is safe bet
const REQUESTS_PER_MINUTE = 400;

// goal of tests is to create a pretty flat denormaized structure
// but all keyed on engine name so that we can easily rate limit by engine
const tests = Object.fromEntries(
    (await Promise.all(
    Object.entries(experiment.engineConfigs)
      .map(async ([engineConfigName, engineConfig]) => {
        // return all the map of all tests in a group if filter is true
        // return only the tests in the groups specified by filter if list is provided
        // return nothing if criteria isn't mentioned

        engineConfig.limits = engineConfig.limits || {};
        engineConfig.limits.tokensPerMinute =
          engineConfig.limits.tokensPerMinute || TOKENS_PER_MINUTE;
        engineConfig.limits.requestsPerMinute =
          engineConfig.limits.requestsPerMinute || REQUESTS_PER_MINUTE;
        engineConfig.limits.baselineTokenUsage =
          engineConfig.limits.baselineTokenUsage || BASELINE_TOKEN_USAGE;

        const allTests = Object.fromEntries(
          await Promise.all(
            Object.entries(experiment.categories).map(async ([c, filter]) => {
              const { groups } = await import(`./categories/${c}.js`);
              if (filter === true) return [c, groups];
              if (filter === false) return [c, []];
              return [
                c,
                Object.fromEntries(
                  Object.entries(groups).filter(([groupName, _]) => {
                    // only include groups that are specified
                    return filter.indexOf(groupName) > -1;
                  })
                ),
              ];
            })
          )
        );

        const engine = await import(`./../engines/${engineConfig.engine}/engine.js`);

        // jam the details of the engine and the category and group into the test itself
        const fullTests = Object.entries(allTests).map(([category, groups]) => {
          return Object.entries(groups).map(([groupName, tests]) => {
            return tests.map((test) => {
              const testObj = {};
              // also have a look at additionalParameters parsing when we run
              // the engine, changes here might require changes there too
              testObj["engineConfig"] = engineConfig;
              testObj["engineConfigName"] = engineConfigName;
              testObj["category"] = category;
              testObj["group"] = groupName;
              testObj["testParams"] = test;
              return testObj;
            });
          });
        });

        return [engineConfigName, fullTests.flat(2)];
      }
    )
  ))
  .filter(entry => {
    return entry[0] !== undefined;
  })
);

console.log(chalk.blue("Experiment Configuration:"));
console.log("Experiment Name: " + experimentResultsName);
if (isContinuing) {
  console.log(`  will attempt to use ${previousResults.length} previously saved test results`);
}
console.log("Sequential: " + (experiment.sequential || "false"));
console.log("Verbose: " + experiment.verbose);
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


const progress = new cliProgress.MultiBar(
  {
    clearOnComplete: true,
    hideCursor: true,
    format:
      "{bar} | ETA: {eta}s | {earlyResults} = {value} of {total} | {engineConfigName} | {inProgress}",
    stream: experiment.verbose > 0
    ? fs.createWriteStream(process.platform === "win32" ? "NULL" : "/dev/null")
    : process.stderr,

  },
  cliProgress.Presets.rect
);

const printProgress = (s) => {
  if (s.size === 0) return "[paused for rate limiting]";
  return `[${s.size} generating]: ${Array.from(s).join(", ")})`;
};

const printEarlyResults = (r) => {
  // cute little check or x emoji response for pass/fail
  return `${chalk.bold(chalk.green(r[true]))} + ${chalk.bold(
    chalk.red(r[false])
  )}`;
};

const runEngineTests = async ([engineConfigName, engineTests]) => {
  const tokenLimitConfig = {
    tokensPerInterval: engineTests[0].engineConfig.limits.tokensPerMinute,
    interval: "minute",
  };
  const requestLimitConfig = {
    tokensPerInterval: engineTests[0].engineConfig.limits.requestsPerMinute,
    interval: "minute",
  };

  const requestLimiter = new RateLimiter(requestLimitConfig);
  const tokenLimiter = new RateLimiter(tokenLimitConfig);

  const inProgress = new Set();
  const earlyResults = { true: 0, false: 0 };
  const engineBar = progress.create(engineTests.length, 0, {
    engineConfigName,
    earlyResults: printEarlyResults(earlyResults),
    inProgress: printProgress(inProgress),
  });
  if (experiment.verbose > 0)
    console.log(chalk.blue(`Running tests for: ${engineConfigName}`));

  let testRuns = [];
  if (experiment.sequential) {
    testRuns = await engineTests.reduce(async (promise, test) => {
      const acc = await promise;
      const result = await runSingleTest(
        test,
        requestLimiter,
        tokenLimiter,
        inProgress,
        earlyResults,
        engineBar
      );

      return [...acc, result];
    }, Promise.resolve([]));
  } else {
    testRuns = await Promise.all(
      engineTests.map((test) =>
        runSingleTest(
          test,
          requestLimiter,
          tokenLimiter,
          inProgress,
          earlyResults,
          engineBar
        )
      )
    );
  }

  engineBar.update({ inProgress: "[Done]" });
  if (experiment.verbose > 0)
    console.log(chalk.blue(`Finished all tests for: ${engineConfigName}`));

  return testRuns;
};

const runSingleTest = async (
  test,
  requestLimiter,
  tokenLimiter,
  inProgress,
  earlyResults,
  engineBar
) => {
  const name = test.testParams["name"];
  const cachedResult = previousResults.find(r => {
    return (
      r.engineConfigName == test.engineConfigName && 
      r.category == test.category && 
      r.group == test.group &&
      r.testParams.name == test.testParams.name
    )
  })

  let testWithResult;
  if (cachedResult) {
    if (experiment.verbose > 0)
      console.log(chalk.blue(`No need to run "${name}" test, we already have results from previous experiment run.`));

    testWithResult = cachedResult;

  } else {
    const additionalTestParametersTokenCount =
      enc.encode(test.testParams["prompt"]).length +
      Object.entries(test.testParams.additionalParameters)
        .map(([_, v]) => {
          return enc.encode(String(v)).length; 
        })
        .reduce((a, b) => a + b, 0);

    const totalTokens =
      additionalTestParametersTokenCount +
      test.engineConfig.limits.baselineTokenUsage;

    if (experiment.verbose === 2)
      console.log(chalk.blue(`Starting test: ${name}. Awaiting rate limit. Requested additional ${additionalTestParametersTokenCount} tokens beyond the baselineTokenUsage (${test.engineConfig.limits.baselineTokenUsage})`));

    await requestLimiter.removeTokens(1);
    await tokenLimiter.removeTokens(totalTokens);

    const engine = await import(
      `../engines/${test["engineConfig"]["engine"]}/engine.js`
    );
    const instance = new engine.default();

    if (experiment.verbose === 2)
      console.log(
        chalk.blue(`Rate limit passed ${name}, awaiting engine response`)
      );

    inProgress.add(name);
    engineBar.update({ inProgress: printProgress(inProgress) });

    const additionalParameters = {
      ...test.engineConfig.additionalParameters,
      ...test.testParams.additionalParameters,
    };

    if (experiment.verbose === 2) {
      console.log(additionalParameters)
    }

    const startTime = Date.now();
    let generateResponse = await instance.generate(
      test.testParams["prompt"],
      test.testParams["currentModel"],
      additionalParameters
    );

    testWithResult = structuredClone(test);
    testWithResult["duration"] = Date.now() - startTime;
    testWithResult["generatedResponse"] = generateResponse || {};

    if (experiment.verbose === 2) {
      console.log(
        chalk.blue(
          `Response returned: ${name}, awaiting evaluation of the generated response:`
        )
      );
      console.log(
        JSON.stringify(generateResponse, null, 2)
      );
      console.log();
      // pretty json print the expectations
      console.log(chalk.blue("Against these expectations:"));
      console.log(JSON.stringify(test.testParams["expectations"], null, 2));
    }

    const { evaluate } = await import(`./categories/${test.category}.js`);
    testWithResult["failures"] = await evaluate(
      testWithResult["generatedResponse"],
      test.testParams["expectations"]
    );
    // return count of each failure type
    testWithResult["failureSummary"] = testWithResult["failures"].reduce(
      (acc, failure) => {
        acc[failure.type] = (acc[failure.type] || 0) + 1;
        return acc;
      },
      {}
    );
    testWithResult["pass"] = testWithResult["failures"].length == 0;

    if (experiment.verbose > 0) {
      console.log(
        chalk.blue(
          `Finished evaluation in ${Math.round(
            testWithResult["duration"] / 1000
          )}s: ${name}`
        )
      );
      if (testWithResult["pass"]) {
        console.log(chalk.bold(chalk.green("Passed")));
      } else {
        console.log(chalk.bold(chalk.red("Failed")));
        testWithResult["failures"].forEach((failure) => {
          console.log(failure.details);
          console.log()
        });
      }
      console.log();
    }
    testWithResult["name"] = name;
    fs.appendFileSync(`${experimentResultsName}${inProgressFileSuffix}`, JSON.stringify(testWithResult) + "\n");
  }

  inProgress.delete(name);
  earlyResults[testWithResult["pass"]] += 1;
  engineBar.increment(1, { inProgress: printProgress(inProgress) });
  engineBar.update({ earlyResults: printEarlyResults(earlyResults) });

  return testWithResult;
};

const output = experiment.sequential
  ? await Object.entries(tests).reduce(async (promise, engineEntry) => {
      const acc = await promise;
      const result = await runEngineTests(engineEntry);
      return [...acc, result];
    }, Promise.resolve([]))
  : await Promise.all(Object.entries(tests).map(runEngineTests));

progress.stop();

const responses = output.flat(1);
const results = new dataForge.DataFrame({ values: responses });


// write the full results to json file
fs.writeFileSync(
  `${experimentResultsName}_full_results.json`,
  JSON.stringify({ results: responses }, null, 2)
);
fs.unlinkSync(`${experimentResultsName}${inProgressFileSuffix}`);

const engineFailureTypes = [];
results.forEach((result) => {
  if (Object.keys(result["failureSummary"]).length > 1) {
    engineFailureTypes.push({
      engineConfigName: result["engineConfigName"],
      failureType: `${result["category"]} - Multiple kinds of failures`,
      id: engineFailureTypes.length,
    });
  } else if (Object.keys(result["failureSummary"]).length == 1) {
    engineFailureTypes.push({
      engineConfigName: result["engineConfigName"],
      failureType: `${result["category"]} - ${
        Object.keys(result["failureSummary"])[0]
      }`,
      id: engineFailureTypes.length,
    });
  }
});
fs.writeFileSync(
  `${experimentResultsName}_failure_summary.csv`,
  await pivotAndUnstack(
    new dataForge.DataFrame({ values: engineFailureTypes }),
    "engineConfigName",
    "failureType",
    "id",
    (v) => v.count()
  ).toCSV()
);

const summary = pivotAndUnstack(
  results.withSeries({
    pass: (df) => df.select((row) => (row["pass"] ? 1 : 0)),
  }),
  "engineConfigName",
  "category",
  "pass",
  (values) => values.average()
);
printTable(summary);
fs.writeFileSync(`${experimentResultsName}_summary.csv`, await summary.toCSV());

console.log(chalk.blue(`Wrote result and summaries to various ${chalk.bold(experimentResultsName)} files`));
