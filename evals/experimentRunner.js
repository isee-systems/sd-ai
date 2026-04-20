import dataForge from "data-forge";
import fs from "fs";

import { RateLimiter } from "limiter";
import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

import cliProgress from "cli-progress";
import chalk from "chalk";

import { printTable, pivotAndUnstack } from "./helpers.js";
import {
  applyDefaultLimits,
  loadCategoryTests,
  loadTestsForEngine,
} from "./runHelpers.js";
import { runInBatches } from "./concurrencyHelper.js";

const enc = new Tiktoken(o200k_base);

export const inProgressFileSuffix = "_in_progress.jsonl";

export async function buildTests(experiment) {
  return Object.fromEntries(
    (
      await Promise.all(
        Object.entries(experiment.engineConfigs).map(
          async ([engineConfigName, rawEngineConfig]) => {
            const engineConfig = applyDefaultLimits(rawEngineConfig);

            const allTests = Object.fromEntries(
              await Promise.all(
                Object.entries(experiment.categories).map(
                  async ([categoryName, filter]) => {
                    const { groups } = await import(
                      `./categories/${categoryName}.js`
                    );
                    return [categoryName, loadCategoryTests(groups, filter)];
                  }
                )
              )
            );

            await import(`../engines/${engineConfig.engine}/engine.js`);

            return [
              engineConfigName,
              loadTestsForEngine(allTests, engineConfig, engineConfigName),
            ];
          }
        )
      )
    ).filter((entry) => entry[0] !== undefined)
  );
}

export async function runExperiment(
  experiment,
  tests,
  experimentResultsName,
  options = {}
) {
  const { previousResults = [], runMetadata = null } = options;
  const verbose = experiment.verbose ?? 0;

  const progress = new cliProgress.MultiBar(
    {
      clearOnComplete: true,
      hideCursor: true,
      format:
        "{bar} | ETA: {eta}s | {earlyResults} = {value} of {total} | {engineConfigName} | {inProgress}",
      stream:
        verbose > 0
          ? fs.createWriteStream(
              process.platform === "win32" ? "NULL" : "/dev/null"
            )
          : process.stderr,
    },
    cliProgress.Presets.rect
  );

  const printProgress = (s) => {
    if (s.size === 0) return "[paused for rate limiting]";
    return `[${s.size} generating]: ${Array.from(s).join(", ")})`;
  };

  const printEarlyResults = (r) => {
    return `${chalk.bold(chalk.green(r[true]))} + ${chalk.bold(
      chalk.red(r[false])
    )}`;
  };

  const runSingleTest = async (
    test,
    requestLimiter,
    tokenLimiter,
    inProgress,
    earlyResults,
    engineBar,
    errorTracker
  ) => {
    const name = test.testParams["name"];
    const cachedResult = previousResults.find((r) => {
      return (
        r.engineConfigName == test.engineConfigName &&
        r.category == test.category &&
        r.group == test.group &&
        r.testParams.name == test.testParams.name
      );
    });

    let testWithResult;
    if (cachedResult) {
      if (verbose > 0)
        console.log(
          chalk.blue(
            `No need to run "${name}" test, we already have results from previous experiment run.`
          )
        );
      testWithResult = cachedResult;
    } else {
      const additionalTestParametersTokenCount =
        enc.encode(test.testParams["prompt"]).length +
        Object.entries(test.testParams.additionalParameters)
          .map(([_, v]) => enc.encode(String(v)).length)
          .reduce((a, b) => a + b, 0);

      const totalTokens =
        additionalTestParametersTokenCount +
        test.engineConfig.limits.baselineTokenUsage;

      if (verbose === 2)
        console.log(
          chalk.blue(
            `Starting test: ${name}. Awaiting rate limit. Requested additional ${additionalTestParametersTokenCount} tokens beyond the baselineTokenUsage (${test.engineConfig.limits.baselineTokenUsage})`
          )
        );

      await requestLimiter.removeTokens(1);
      await tokenLimiter.removeTokens(totalTokens);

      const engine = await import(
        `../engines/${test["engineConfig"]["engine"]}/engine.js`
      );
      const instance = new engine.default();

      if (verbose === 2)
        console.log(
          chalk.blue(`Rate limit passed ${name}, awaiting engine response`)
        );

      inProgress.add(name);
      engineBar.update({ inProgress: printProgress(inProgress) });

      const additionalParameters = {
        ...test.engineConfig.additionalParameters,
        ...test.testParams.additionalParameters,
      };

      if (verbose === 2) {
        console.log(additionalParameters);
      }

      const startTime = Date.now();
      let generateResponse = await instance.generate(
        test.testParams["prompt"],
        test.testParams["currentModel"],
        additionalParameters
      );

      if (experiment.breakOnError && generateResponse && generateResponse.err) {
        const currentErrorStr = JSON.stringify(generateResponse.err);

        errorTracker.retryCount++;
        errorTracker.errorHistory.push({
          attempt: errorTracker.retryCount,
          error: generateResponse.err,
          errorStr: currentErrorStr,
        });

        if (errorTracker.lastError === currentErrorStr) {
          progress.stop();
          console.clear();
          console.error(
            chalk.red(chalk.bold("\n\nERROR: Same error occurred twice in a row"))
          );
          console.error(chalk.red(`Test name: ${name}`));
          console.error(chalk.red(`Engine: ${test.engineConfig.engine}`));
          console.error(chalk.red(`\nAll errors encountered:`));
          errorTracker.errorHistory.forEach((entry) => {
            console.error(chalk.red(`\nAttempt ${entry.attempt}:`));
            console.error(entry.error);
          });
          process.exit(1);
        }

        if (errorTracker.retryCount >= 3) {
          progress.stop();
          console.clear();
          console.error(
            chalk.red(chalk.bold("\n\nERROR: Maximum retry limit (3) reached"))
          );
          console.error(chalk.red(`Test name: ${name}`));
          console.error(chalk.red(`Engine: ${test.engineConfig.engine}`));
          console.error(chalk.red(`\nAll errors encountered:`));
          errorTracker.errorHistory.forEach((entry) => {
            console.error(chalk.red(`\nAttempt ${entry.attempt}:`));
            console.error(entry.error);
          });
          process.exit(1);
        }

        errorTracker.lastError = currentErrorStr;
        if (verbose > 0) {
          console.log(
            chalk.yellow(
              `\nWarning: Error occurred for test "${name}" (retry ${errorTracker.retryCount}/3), retrying...`
            )
          );
          console.log(chalk.yellow(`Error: ${currentErrorStr}`));
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));

        return runSingleTest(
          test,
          requestLimiter,
          tokenLimiter,
          inProgress,
          earlyResults,
          engineBar,
          errorTracker
        );
      }

      errorTracker.lastError = null;
      errorTracker.retryCount = 0;
      errorTracker.errorHistory = [];

      testWithResult = structuredClone(test);
      testWithResult["duration"] = Date.now() - startTime;
      testWithResult["generatedResponse"] = generateResponse || {};

      if (verbose === 2) {
        console.log(
          chalk.blue(
            `Response returned: ${name}, awaiting evaluation of the generated response:`
          )
        );
        console.log(JSON.stringify(generateResponse, null, 2));
        console.log();
        console.log(chalk.blue("Against these expectations:"));
        console.log(JSON.stringify(test.testParams["expectations"], null, 2));
      }

      const { evaluate } = await import(`./categories/${test.category}.js`);
      testWithResult["failures"] = await evaluate(
        testWithResult["generatedResponse"],
        test.testParams["expectations"]
      );
      testWithResult["failureSummary"] = testWithResult["failures"].reduce(
        (acc, failure) => {
          acc[failure.type] = (acc[failure.type] || 0) + 1;
          return acc;
        },
        {}
      );
      testWithResult["pass"] = testWithResult["failures"].length == 0;

      if (verbose > 0) {
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
            console.log();
          });
        }
        console.log();
      }

      testWithResult["name"] = name;
      fs.appendFileSync(
        `${experimentResultsName}${inProgressFileSuffix}`,
        JSON.stringify(testWithResult) + "\n"
      );
    }

    inProgress.delete(name);
    earlyResults[testWithResult["pass"]] += 1;
    engineBar.increment(1, { inProgress: printProgress(inProgress) });
    engineBar.update({ earlyResults: printEarlyResults(earlyResults) });

    return testWithResult;
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
    const errorTracker = { lastError: null, retryCount: 0, errorHistory: [] };
    const engineBar = progress.create(engineTests.length, 0, {
      engineConfigName,
      earlyResults: printEarlyResults(earlyResults),
      inProgress: printProgress(inProgress),
    });

    if (verbose > 0)
      console.log(chalk.blue(`Running tests for: ${engineConfigName}`));

    let testRuns;
    const concurrency =
      experiment.concurrency ||
      (experiment.sequential ? 1 : engineTests.length);

    if (concurrency === 1) {
      testRuns = await engineTests.reduce(async (promise, test) => {
        const acc = await promise;
        const result = await runSingleTest(
          test,
          requestLimiter,
          tokenLimiter,
          inProgress,
          earlyResults,
          engineBar,
          errorTracker
        );
        return [...acc, result];
      }, Promise.resolve([]));
    } else if (concurrency >= engineTests.length) {
      testRuns = await Promise.all(
        engineTests.map((test) =>
          runSingleTest(
            test,
            requestLimiter,
            tokenLimiter,
            inProgress,
            earlyResults,
            engineBar,
            errorTracker
          )
        )
      );
    } else {
      testRuns = await runInBatches(
        engineTests,
        (test) =>
          runSingleTest(
            test,
            requestLimiter,
            tokenLimiter,
            inProgress,
            earlyResults,
            engineBar,
            errorTracker
          ),
        concurrency
      );
    }

    engineBar.update({ inProgress: "[Done]" });
    if (verbose > 0)
      console.log(chalk.blue(`Finished all tests for: ${engineConfigName}`));

    return testRuns;
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

  const resultData = { results: responses };
  if (runMetadata) resultData.runMetadata = runMetadata;

  fs.writeFileSync(
    `${experimentResultsName}_full_results.json`,
    JSON.stringify(resultData, null, 2)
  );

  if (fs.existsSync(`${experimentResultsName}${inProgressFileSuffix}`)) {
    fs.unlinkSync(`${experimentResultsName}${inProgressFileSuffix}`);
  }

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

  console.log(
    chalk.blue(
      `Wrote result and summaries to various ${chalk.bold(
        experimentResultsName
      )} files`
    )
  );

  return { responses, summary };
}
