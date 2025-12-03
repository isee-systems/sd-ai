import { execFile, spawnSync } from "node:child_process";
import util from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = util.promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const desc = `
Causal Decoder is a transformer decoder-only model fine-tuned on Qwen2.5-1.5B, which is an open-source small LLM with only 1.5 billion parameters. The model was fine-tuned using PyTorch. It is not a chat model, so it only works properly when the input is of the form 'more x leads to more y' etc. This model is in the process of development.
`;


class Engine {
  static description() {
    return desc;
  }

  static supportedModes() {
    try {
      const pythonExe =
        process.env.PYTHON ||
        (process.platform === "win32" ? "python" : "python3");

      const check = spawnSync(
        pythonExe,
        ["-c", "import transformers, torch, accelerate"],
        { encoding: "utf8" }
      );


      if (check.error || check.status !== 0) {
        return [];
      }

      return ["cld"];
    } catch {
      return [];
    }
  }

  additionalParameters() {
    return [{
        name: "backgroundKnowledge",
        type: "string",
        required: false,
        uiElement: "textarea",
        saveForUser: "local",
        label: "Background Knowledge",
        description: "Background information you want the underlying model to consider when generating a diagram for you",
        minHeight: 100
    }];
  }

  //this combines the background knowledge and the prompt together if there are both
  normalizePrompt(prompt, candidate) {
    let content = "";
    let background = "";
    if (candidate && typeof candidate === "object") {
      background = String(candidate.backgroundKnowledge ?? "").trim();
    } else if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (!trimmed) background = "";

      try {
        const parsed = JSON.parse(trimmed);
        background = String(parsed?.backgroundKnowledge ?? "").trim();
      } catch {
        background = trimmed;
      }
    }

    if (prompt)
      content = prompt.trim();

    if (content.length > 0)
      content += " " + background;

    return content.trim();
  }

  //this makes this engine nominally iterative... it just adds onto the existing model
  combineModels(currentModel, newModel) {
    let ret = {
      specs: currentModel?.specs,
      variables: [],
      relationships: []
    };

    const processRelationship = function(r) {
      let duplicate = false;
      //first determine if a relationship from from to to exists already
      for (const existing of ret.relationships) {
        if (existing.from == r.from && existing.to == r.to) {
          duplicate = true;
          break;
        }
      }

      //if it doesn't add it to the returned model
      if (!duplicate) {

        if (ret.variables.indexOf(r.from) < 0)
          ret.variables.push(r.from);

        if (ret.variables.indexOf(r.to) < 0)
          ret.variables.push(r.to);

        ret.relationships.push(r);
      }
    };

    //give precedence to relationships from new model
    newModel?.relationships.forEach(processRelationship);
    //then add the relationships from the old model for completeness
    currentModel?.relationships.forEach(processRelationship);

    //turn variables into objects with name
    ret.variables = ret.variables.map((v) => {
      return {
        name: v
      }
    });

    return {model: ret};
  }

  async generate(prompt, currentModel, parameters) {
    const candidate = parameters;
    const effectivePrompt = this.normalizePrompt(prompt, candidate);

    if (!effectivePrompt) {
      return { err: "No prompt provided (no backgroundKnowledge or text found)" };
    }

    try {
      const pythonExe =
        process.env.PYTHON ||
        (process.platform === "win32" ? "python" : "python3");
      const scriptPath = path.resolve(__dirname, "inference.py");

      const { stdout, stderr } = await execFileP(
        pythonExe,
        [scriptPath, effectivePrompt],
        {
          maxBuffer: 20 * 1024 * 1024,
        }
      );

      if (stderr && stderr.length) {
        console.warn(
          "[causal-decoder] PY STDERR:",
          stderr.toString().slice(0, 500)
        );
      }

      const raw = stdout?.toString() ?? "";
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {
          err: "Python did not return valid JSON",
          raw: raw.slice(0, 800),
        };
      }

      if (parsed && typeof parsed === "object") {
        return this.combineModels(currentModel, parsed.model ?? parsed );
      }

      return {
        err: "Unexpected Python output format",
        raw: raw.slice(0, 800),
      };
    } catch (err) {
      return { err: err.message || String(err) };
    }
  }
}

export default Engine;
