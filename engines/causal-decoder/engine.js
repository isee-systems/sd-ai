import { execFile } from "node:child_process";
import util from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = util.promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Engine {
  static description() {
    return "Python-backed causal translation engine. Input: prompt string. Output: JSON of relationships.";
  }

  static supportedModes() {
    return ["cld"];
  }

  static additionalParameters() {
    return [
      {
        name: "prompt",
        type: "string",
        required: true,
        uiElement: "textarea",
        label: "Prompt",
        description: "Input text to analyze for causal relationships.",
      },
    ];
  }

  description() {
    return Engine.description();
  }

  supportedModes() {
    return Engine.supportedModes();
  }

  additionalParameters() {
    return Engine.additionalParameters();
  }

  async generate(prompt, currentModel, parameters) {
    const effectivePrompt =
      parameters?.prompt?.trim?.() || prompt?.trim?.() || "";

    if (!effectivePrompt) {
      return { err: "No prompt provided" };
    }

    try {
      const pythonExe =
        process.env.PYTHON ||
        (process.platform === "win32" ? "python" : "python3");
      const scriptPath = path.resolve(__dirname, "inference.py");

      const { stdout, stderr } = await execFileP(pythonExe, [scriptPath, effectivePrompt], {
        maxBuffer: 20 * 1024 * 1024,
      });

      if (stderr && stderr.length) {
        console.warn("[causal-decoder] PY STDERR:", stderr.toString().slice(0, 500));
      }

      const raw = stdout?.toString() ?? "";
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { err: "Python did not return valid JSON", raw: raw.slice(0, 800) };
      }

      if (parsed && typeof parsed === "object") {
        return { model: parsed.model ?? parsed };
      }

      return { err: "Unexpected Python output format", raw: raw.slice(0, 800) };
    } catch (err) {
      return { err: err.message || String(err) };
    }
  }
}

export default Engine;
