import { randomBytes } from 'crypto';
import { join, resolve, normalize, dirname } from 'path';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { XMLValidator } from 'fast-xml-parser';
import { LLMWrapper } from '../../utilities/LLMWrapper.js';
import logger from '../../utilities/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * VisualizationEngine
 * Creates visualizations using Python/matplotlib
 *
 * Key Features:
 * - Always returns SVG string
 * - Python/matplotlib for template-based visualizations
 * - AI-generated custom Python code for unique requirements
 * - Session-specific temp folder management
 * - Automatic cleanup after visualization creation
 */
export class VisualizationEngine {
  constructor(sessionManager, sessionId) {
    this.sessionManager = sessionManager;
    this.sessionId = sessionId;
    this.sessionTempDir = sessionManager.getSessionTempDir(sessionId);

    if (!this.sessionTempDir) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Normalize and resolve the session temp directory for security checks
    this.resolvedTempDir = resolve(normalize(this.sessionTempDir));

    this.clientId = sessionManager.getSession(sessionId)?.clientId ?? null;
  }

  /**
   * Validate that a file path is within the session temp directory
   * This prevents path traversal attacks (e.g., ../../etc/passwd)
   * @param {string} filePath - The file path to validate
   * @returns {string} The validated, resolved path
   * @throws {Error} If the path is outside the session temp directory
   */
  validatePath(filePath) {
    // Resolve and normalize the path to eliminate any .. or symbolic links
    const resolvedPath = resolve(normalize(filePath));

    // Check if the resolved path starts with the session temp directory
    if (!resolvedPath.startsWith(this.resolvedTempDir + '/') && resolvedPath !== this.resolvedTempDir) {
      throw new Error(`Security violation: Path '${filePath}' is outside session directory`);
    }

    return resolvedPath;
  }

  /**
   * Generate a unique visualization ID
   */
  generateVizId() {
    return `viz_${randomBytes(8).toString('hex')}`;
  }

  /**
   * Truncate all arrays in data to the shortest length among time and the requested variables.
   * Prevents matplotlib errors when detailed run data and time arrays have different lengths.
   */
  #normalizeRunData(runData, variables, label) {
    if (!runData?.time || !Array.isArray(runData.time)) return runData;
    const keys = ['time', ...variables].filter(k => Array.isArray(runData[k]));
    const minLen = Math.min(...keys.map(k => runData[k].length));
    if (keys.every(k => runData[k].length === minLen)) return runData;
    const trimmed = keys.filter(k => runData[k].length > minLen);
    logger.log(`normalizeArrayLengths${label ? ` ${label}` : ''}: trimming to ${minLen} points. Affected keys: ${trimmed.map(k => `${k}(${runData[k].length})`).join(', ')}`);
    const normalized = { ...runData };
    for (const k of trimmed) normalized[k] = normalized[k].slice(0, minLen);
    return normalized;
  }

  normalizeArrayLengths(data, variables) {
    // Run-keyed comparison format: { runId: { time: [...], var1: [...], ... } }
    // Each run is flat and normalized independently.
    if (data && typeof data === 'object' && !Array.isArray(data) && !('time' in data)) {
      const firstVal = data[Object.keys(data)[0]];
      if (firstVal && typeof firstVal === 'object' && !Array.isArray(firstVal) && Array.isArray(firstVal.time)) {
        const normalized = {};
        for (const [runId, runData] of Object.entries(data)) {
          normalized[runId] = this.#normalizeRunData(runData, variables, runId);
        }
        return normalized;
      }
    }

    // Flat format: { time, var1, var2, ... } (time_series, phase_portrait, feedback_dominance)
    return this.#normalizeRunData(data, variables, null);
  }

  /**
   * Create visualization - always returns SVG string
   */
  async createVisualization(type, data, variables, options = {}) {
    const useAICustom = options.useAICustom || false;

    if (useAICustom) {
      return await this.createAICustomVisualization(data, variables, options);
    } else {
      return await this.createVisualizationWithPython(type, data, variables, options);
    }
  }

  /**
   * Render a simplified causal loop diagram - returns SVG string.
   *
   * An LLM writes the SVG directly from the simplified loops the agent supplies
   * (no Python, no graphviz/networkx dependency). The spec is authored by the
   * agent LLM from feedback analysis — it is NOT the raw Loops That Matter
   * structure.
   *
   * The generated markup is validated as well-formed XML; if it is malformed the
   * broken SVG and the parser's error are sent back to the model to repair, up to
   * a few attempts. Throws if no valid SVG can be produced.
   */
  async createCausalLoopDiagram(spec, options = {}) {
    const loops = Array.isArray(spec.loops) ? spec.loops.filter(l => Array.isArray(l.links) && l.links.length) : [];
    if (loops.length === 0) {
      throw new Error('No loops with links were provided to draw.');
    }

    const width = options.width || 940;
    const height = options.height || 700;
    const title = options.title || spec.title || 'Causal Loop Diagram';
    const notes = options.notes || spec.notes || '';
    // Long-form prose (per-loop explanations + the narrative caption) is omitted
    // by default so the diagram stays clean; only drawn when the end user asks.
    const showDescriptions = options.showDescriptions === true;

    const systemPrompt = `You are an expert systems-dynamics diagrammer. You draw clean, publication-quality causal loop diagrams (CLDs) as a single self-contained SVG document.

OUTPUT CONTRACT:
- Output ONLY the SVG. No prose, no markdown fences. Start with <svg ...> (an <?xml ...?> prolog is allowed) and end with </svg>.
- The SVG must be WELL-FORMED XML: every element closed, every attribute quoted, and every literal & < > inside text or attributes escaped as &amp; &lt; &gt;.
- It must be self-contained (no external fonts/images/scripts) and use the exact canvas size requested.
- Render EVERY variable and EVERY link given, exactly as specified. Never invent, drop, rename, or merge variables or links. Reproduce variable names verbatim (XML-escaped).

CLD CONVENTIONS:
- Draw each variable as a PLAIN TEXT label. Do NOT enclose variable names in boxes, ellipses, circles, or any shape — text only. Wrap long names onto multiple lines.
- Draw each link as a curved directed arrow from "from" to "to". Use a FILLED triangle arrowhead (solid fill in the link's loop color) with markerWidth="6" markerHeight="6"; the arrowhead must stop at least 8 px from the destination label's bounding box edge so it never overlaps the text or the polarity mark.
- Each link's polarity mark is "+" for a "+" link and the minus sign "−" (U+2212) for a "-" link. Place it near the arrowhead (the destination end of the link), offset 10–12 px perpendicular to the curve and away from the loop centre. Render it bold, font-size 13 px minimum, in the exact hex color of that loop's arrows. Back every polarity mark with a solid white filled rectangle (2 px padding on each side, no stroke, opacity 1.0) so it reads clearly over any overlapping line. Never render a polarity mark in black or any color other than its loop color.
- Mark each loop near its centre with just a rotation symbol and its id, e.g. "↻ R1" (clockwise "↻" for reinforcing, counter-clockwise "↺" for balancing). Do NOT enclose this loop indicator in a circle, badge, box, or any shape — only the symbol and the identifier, drawn in the loop's color. Give each loop a distinct color and color its links to match; choose colors dark enough to contrast strongly with the white canvas/backing — if a loop color's luminance is within ~40 WCAG units of white, darken it until it clearly stands out.
- Include a legend GROUPED into two sections under the headings "Reinforcing" and "Balancing", so the loop type is written once per section, never repeated per loop. Under each heading list that section's loops — color swatch, id, and short label — ordered alphabetically by loop id. Omit a heading if it has no loops. NEVER print any percentage or "% of behavior" anywhere on the diagram.
- Draw ALL links with the SAME stroke thickness. Do not vary link width for any reason.
- Put the title at the top.
- KEEP THE DIAGRAM CLEAN: do not add any descriptive prose of your own. Render per-loop explanation sentences and a narrative caption ONLY when they are explicitly provided in the user message below; otherwise show just the structure (nodes, links, polarity, loop badges) and the concise legend.

LAYOUT QUALITY — this is what separates a good diagram from a bad one:
- MOST IMPORTANT — DRAW EVERY LOOP AS A CIRCLE. A reader must instantly recognise each feedback loop as a ring; a circular shape is the single most important visual property of the diagram.
- Reinforce the circular shape by curving each edge around the centroid of the SHORTEST loop it belongs to — the edge bows outward, away from that loop's centre, so the loop's edges enclose its centre like a ring. For a two-node reciprocal pair, curve the two arrows to opposite sides so together they form a small circle.
- Position labels to MINIMIZE overlap and crossing connectors. Spread them out; never let text labels collide or sit on top of arrows.
- Start and end each arrow with a small gap from the text labels (do not let arrowheads touch the letters).`;

    // Strip explanations from the loop JSON unless descriptions were requested,
    // so the model has nothing extra to render.
    const loopsForPrompt = showDescriptions
      ? loops
      : loops.map(({ explanation, ...rest }) => rest);

    const descriptionDirective = showDescriptions
      ? `Descriptions ARE requested: render each loop's "explanation" in the legend, and${notes ? '' : ' (if you have one)'} render the narrative caption at the bottom in italic.\n${notes ? `Narrative caption (render at the bottom, italic):\n${notes}\n` : ''}`
      : `Keep the diagram clean: show only the structure and the concise legend. Do NOT draw any loop explanation sentences or a narrative caption.\n`;

    const userPrompt = `Draw this causal loop diagram as SVG.

Canvas: ${width} wide by ${height} tall (px).
Title: ${title}
${descriptionDirective}Loops to draw (JSON — id, polarity, optional label${showDescriptions ? '/explanation' : ''}, and ordered links each with from/to/polarity):
${JSON.stringify(loopsForPrompt, null, 2)}

Remember: output ONLY the SVG document, drawn at ${width}x${height}, reproducing every variable and link exactly.`;

    const vizLLM = new LLMWrapper({ clientId: this.clientId, underlyingModel: options.underlyingModel });
    const { temperature, underlyingModel: parsedModel, reasoningEffort } = vizLLM.getLLMParameters(0.2);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const maxAttempts = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await vizLLM.createChatCompletion(messages, parsedModel, null, temperature, reasoningEffort);
      const raw = response.content || '';
      const svg = this.#extractSvgDocument(raw);
      const validation = this.#validateSvg(svg);

      if (validation.ok) {
        return svg;
      }

      lastError = validation.error;
      logger.log(`[VizEngine] CLD SVG invalid on attempt ${attempt}/${maxAttempts}: ${lastError}`);

      if (attempt < maxAttempts) {
        // Show the model exactly what it returned and the parser error, ask it to fix.
        messages.push({ role: 'assistant', content: svg ?? raw });
        messages.push({
          role: 'user',
          content: `The SVG you returned is not valid: ${lastError}

Here is the SVG you returned:
${svg ?? raw}

Return a corrected version that is well-formed XML and renders the same causal loop diagram. Output ONLY the SVG document, nothing else.`
        });
      }
    }

    throw new Error(`Could not produce a valid SVG after ${maxAttempts} attempts. Last error: ${lastError}`);
  }

  /**
   * Pull the SVG document out of a model response, tolerating markdown fences and
   * surrounding prose. Returns the SVG string, or null if none is present.
   */
  #extractSvgDocument(content) {
    let text = String(content || '').trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```[a-zA-Z]*\r?\n/, '').replace(/\r?\n```$/, '').trim();
    }
    const startIdx = text.search(/<\?xml|<svg[\s>]/i);
    const endIdx = text.toLowerCase().lastIndexOf('</svg>');
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      return null;
    }
    return text.slice(startIdx, endIdx + '</svg>'.length);
  }

  /**
   * Validate that a string is a well-formed SVG document.
   * @returns {{ok: boolean, error?: string}}
   */
  #validateSvg(svg) {
    if (!svg) {
      return { ok: false, error: 'No <svg>…</svg> document was found in the response.' };
    }
    if (!/<svg[\s>]/i.test(svg)) {
      return { ok: false, error: 'The content does not contain an <svg> root element.' };
    }
    const result = XMLValidator.validate(svg);
    if (result === true) {
      return { ok: true };
    }
    const err = result?.err;
    const where = err?.line ? ` (line ${err.line}, col ${err.col})` : '';
    return { ok: false, error: `Malformed XML${where}: ${err?.msg || 'unknown parse error'}` };
  }

  /**
   * Create custom visualization using AI to write Python/matplotlib code - returns SVG string
   */
  async createAICustomVisualization(data, variables, options) {
    const vizId = this.generateVizId();
    const scriptPath = this.validatePath(join(this.sessionTempDir, `visualization-${vizId}.py`));
    const dataPath = this.validatePath(join(this.sessionTempDir, `data-${vizId}.json`));
    const outputPath = this.validatePath(join(this.sessionTempDir, `visualization-${vizId}.svg`));

    let svgContent = null;
    let error = null;

    try {
      // 1. Write data to temp file
      const normalizedData = this.normalizeArrayLengths(data, variables);
      writeFileSync(dataPath, JSON.stringify(normalizedData));

      // 2. Generate Python script using AI
      const pythonScript = await this.generateAIVisualizationScript(
        dataPath, outputPath, data, variables, options
      );
      writeFileSync(scriptPath, pythonScript);
      logger.log(`[VizEngine] AI script created: ${scriptPath} at ${new Date().toISOString()}`);

      // 3. Execute Python script
      await this.executePythonScript(scriptPath);

      // 4. Read generated SVG and validate
      const fileContent = readFileSync(outputPath, 'utf8');

      if (!fileContent.includes('<svg') && !fileContent.includes('<?xml')) {
        throw new Error('Generated file is not a valid SVG image');
      }

      svgContent = fileContent;

    } catch (err) {
      error = err;
      // Suppress error logging - errors are thrown and handled by caller
    } finally {
      // ALWAYS cleanup temp files
      this.cleanupVisualizationFiles(vizId);

      if (error) {
        throw error;
      }
    }

    return svgContent;
  }

  /**
   * Use AI to generate custom Python visualization script
   */
  async generateAIVisualizationScript(dataPath, outputPath, data, variables, options) {
    const actualDataPath = options.feedbackFilePath ?? dataPath;
    const schemaData = options.feedbackFilePath
      ? JSON.parse(readFileSync(options.feedbackFilePath, 'utf8'))
      : data;

    // Always build schema from the actual file on disk — agent's dataDescription is supplemental context only
    const autoSchema = this.buildSchemaDescription(actualDataPath, schemaData);
    const dataDescription = options.dataDescription
      ? `${autoSchema}\n\nAdditional context from caller: ${options.dataDescription}`
      : autoSchema;
    const visualizationGoal = options.visualizationGoal || options.title || 'Visualize the data in an insightful way';

    const systemPrompt = `You are a Python matplotlib code generator. Generate working Python visualization code.

ABSOLUTE RULE — DATA LOADING:
You MUST open and parse the data file yourself at runtime using Python file I/O (e.g. open(), json.load()).
NEVER hardcode, inline, or assume any data values in the script.
NEVER treat data passed in the prompt as the actual data — the prompt only describes the file schema so you know how to read it.
ALL data used in the visualization must come exclusively from reading the file at the path provided.
Write explicit parsing code: open the file, navigate the JSON structure, extract the fields you need.

Requirements:
- Use matplotlib with Agg backend (set BEFORE importing pyplot)
- Load JSON data from disk and create the visualization
- Save as SVG using plt.savefig with format='svg'
- Include labels, titles, legends
- Make it clear and professional

Data handling:
- Use the exact field paths from the schema provided to navigate the JSON — do not guess field names
- Write all data-loading and parsing logic explicitly in the script

Matplotlib rules — these are known sources of errors, follow them exactly:
- Never pass fontweight to ax.plot() or ax.scatter() — it is not a valid kwarg for Line2D or PathCollection
- ax.annotate ha= only accepts 'left', 'right', 'center' — never 'top' or 'bottom'
- ax.annotate va= accepts 'top', 'bottom', 'center', 'baseline' — never 'left' or 'right'
- Use fig.subplots_adjust() instead of plt.tight_layout()

Composing multiple chart types (background bands + line overlay, stacked area + secondary axis, etc.):
- Draw background period bands with ax.axvspan(zorder=0, linewidth=0)
- Draw overlaid lines at zorder=3 or higher
- Build legends manually using matplotlib.patches.Patch and matplotlib.lines.Line2D rather than relying on automatic label collection`;

    const periodsSchemaNote = (options.highlightPeriods?.length > 0)
      ? `\n\nPRE-DEFINED VARIABLE — HIGHLIGHT_PERIODS:
A Python list named HIGHLIGHT_PERIODS is already defined in the required boilerplate. Each entry has keys: start (number), end (number), label (string), and optionally color (string).
Use axvspan(p['start'], p['end'], ...) to draw background bands and mpatches.Patch for legend entries. Do NOT read any file to get this data — it is already in the variable.`
      : '';

    const schemaPrompt = `DATA FILE SCHEMA for this request:
The following describes the structure of the JSON file on disk. Use the exact field paths to write your parsing code. Do NOT treat these values as data — read everything from disk at runtime.

${dataDescription}${periodsSchemaNote}`;

    const periodsConstant = (options.highlightPeriods?.length > 0)
      ? `5. HIGHLIGHT_PERIODS = ${JSON.stringify(options.highlightPeriods)}  # server-computed dominant loop periods — use these directly, do not re-read from any file\n`
      : '';

    const userPrompt = `Generate Python code for this visualization:

Goal: ${visualizationGoal}
Size: ${(options.width || 800)/100}x${(options.height || 600)/100} inches

${options.customRequirements ? `Requirements: ${options.customRequirements}\n` : ''}
Required — copy these lines exactly, do not alter the paths:
1. matplotlib.use('Agg') BEFORE import matplotlib.pyplot
2. import warnings; warnings.filterwarnings('ignore')
3. with open('${actualDataPath}', 'r') as f: data = json.load(f)
4. plt.savefig('${outputPath}', format='svg', bbox_inches='tight')
${periodsConstant}
Generate ONLY working Python code, no explanations.`;

    try {
      // Construct a properly-configured LLMWrapper so getLLMParameters can parse the model
      // name and extract any thinking-level suffix (e.g., 'gemini-3-flash-preview low').
      const vizLLM = new LLMWrapper({ clientId: this.clientId, underlyingModel: options.underlyingModel });
      const { temperature, underlyingModel: parsedModel, reasoningEffort } = vizLLM.getLLMParameters(0.1);

      // Create messages array.
      // systemPrompt is stable across requests and will be cached.
      // schemaPrompt is request-specific and sent as a separate turn after the system message.
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: schemaPrompt },
        { role: 'assistant', content: 'I have reviewed the data file schema and am ready to generate the visualization code.' },
        { role: 'user', content: userPrompt }
      ];

      const response = await vizLLM.createChatCompletion(
        messages,
        parsedModel,
        null, // no zodSchema
        temperature,
        reasoningEffort
      );

      // Extract Python code from response content
      let pythonCode = response.content.trim();

      // Remove markdown code blocks if present
      if (pythonCode.startsWith('```python')) {
        pythonCode = pythonCode.replace(/```python\r?\n/, '').replace(/\r?\n```$/, '');
      } else if (pythonCode.startsWith('```')) {
        pythonCode = pythonCode.replace(/```\r?\n/, '').replace(/\r?\n```$/, '');
      }

      return pythonCode;

    } catch (err) {
      // Suppress error logging - errors are thrown and handled by caller
      throw new Error(`AI visualization generation failed: ${err.message}`);
    }
  }

  /**
   * Describe data for AI to understand
   */
  buildSchemaDescription(filePath, data) {
    const describe = (val, depth = 0) => {
      if (val === null || val === undefined) return 'null';

      if (Array.isArray(val)) {
        if (val.length === 0) return '[]';
        const first = val[0];
        if (typeof first === 'number') {
          const sample = val.slice(0, Math.min(val.length, 100));
          const min = Math.min(...sample).toFixed(2);
          const max = Math.max(...sample).toFixed(2);
          return `[number, ...]  // ${val.length} values, range ${min}–${max}`;
        }
        if (typeof first === 'string') {
          const preview = val.slice(0, 3).map(s => JSON.stringify(s)).join(', ');
          return `[${preview}${val.length > 3 ? ', ...' : ''}]  // ${val.length} strings`;
        }
        if (typeof first === 'object' && first !== null) {
          const pad = '  '.repeat(depth + 1);
          return `[  // ${val.length} items\n${pad}${describe(first, depth + 1)}\n${'  '.repeat(depth)}]`;
        }
        return JSON.stringify(val.slice(0, 3)) + (val.length > 3 ? '...' : '');
      }

      if (typeof val === 'object') {
        if (depth > 4) return '{...}';
        const pad = '  '.repeat(depth + 1);
        const entries = Object.entries(val)
          .map(([k, v]) => `${pad}"${k}": ${describe(v, depth + 1)}`)
          .join(',\n');
        return `{\n${entries}\n${'  '.repeat(depth)}}`;
      }

      if (typeof val === 'string') return JSON.stringify(val);
      return String(val);
    };

    return `File: ${filePath}\nSchema:\n${describe(data)}`;
  }

  describeData(data, variables) {
    const lines = [];

    // Time series info
    if (data.time) {
      lines.push(`Time series data with ${data.time.length} time points`);
      lines.push(`Time range: ${data.time[0]} to ${data.time[data.time.length - 1]}`);
    }

    // Variables info
    lines.push(`\nVariables (${variables.length}):`);
    variables.forEach(varName => {
      if (data[varName]) {
        const values = data[varName];
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;

        lines.push(`- ${varName}: range [${min.toFixed(2)}, ${max.toFixed(2)}], avg ${avg.toFixed(2)}`);

        // Detect trends
        const first = values[0];
        const last = values[values.length - 1];
        const change = ((last - first) / first * 100).toFixed(1);
        lines.push(`  Trend: ${change > 0 ? 'increasing' : 'decreasing'} by ${Math.abs(change)}%`);
      }
    });

    // Feedback loops if present
    if (data.feedbackLoops) {
      lines.push(`\nFeedback loops: ${data.feedbackLoops.length} loops present`);
      data.feedbackLoops.forEach(loop => {
        lines.push(`- ${loop.name || 'Unnamed'} (${loop.polarity})`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Create visualization using Python (matplotlib) - returns SVG string
   */
  async createVisualizationWithPython(type, data, variables, options) {
    const vizId = this.generateVizId();
    const scriptPath = this.validatePath(join(this.sessionTempDir, `visualization-${vizId}.py`));
    const dataPath = this.validatePath(join(this.sessionTempDir, `data-${vizId}.json`));
    const outputPath = this.validatePath(join(this.sessionTempDir, `visualization-${vizId}.svg`));

    let svgContent = null;
    let error = null;

    try {
      // 1. Write data to temp file
      const normalizedData = this.normalizeArrayLengths(data, variables);
      writeFileSync(dataPath, JSON.stringify(normalizedData));

      // 2. Generate Python script
      const pythonScript = this.generatePythonVisualizationScript(
        type, dataPath, outputPath, variables, options
      );
      writeFileSync(scriptPath, pythonScript);
      logger.log(`[VizEngine] Template script created: ${scriptPath} at ${new Date().toISOString()}`);

      // 3. Execute Python script
      await this.executePythonScript(scriptPath);

      // 4. Read generated SVG and validate
      const fileContent = readFileSync(outputPath, 'utf8');

      if (!fileContent.includes('<svg') && !fileContent.includes('<?xml')) {
        throw new Error('Generated file is not a valid SVG image');
      }

      svgContent = fileContent;

    } catch (err) {
      error = err;
      // Suppress error logging - errors are thrown and handled by caller
    } finally {
      // ALWAYS cleanup temp files
      this.cleanupVisualizationFiles(vizId);

      if (error) {
        throw error;
      }
    }

    return svgContent;
  }

  /**
   * Cleanup visualization temp files
   */
  cleanupVisualizationFiles(vizId) {
    const filesToDelete = [
      join(this.sessionTempDir, `visualization-${vizId}.py`),
      join(this.sessionTempDir, `data-${vizId}.json`),
      join(this.sessionTempDir, `visualization-${vizId}.svg`)
    ];

    for (const file of filesToDelete) {
      try {
        // Validate path before deletion
        const validatedPath = this.validatePath(file);
        if (existsSync(validatedPath)) {
          unlinkSync(validatedPath);
        }
      } catch (err) {
        // Suppress cleanup errors - they're not critical
      }
    }
  }

  // Returns a Python snippet that filters a flat {time, var1, ...} data dict to options.timeRange.
  #timeRangeFilterFlat(options) {
    if (!options?.timeRange) return '';
    const { start, end } = options.timeRange;
    return `
# Apply time range filter
_time_arr = data['time']
_indices = [i for i, t in enumerate(_time_arr) if t >= ${start} and t <= ${end}]
for _key in list(data.keys()):
    if isinstance(data[_key], list) and len(data[_key]) == len(_time_arr):
        data[_key] = [data[_key][i] for i in _indices]
`;
  }

  // Returns a Python snippet that filters a run-keyed {runId: {time, var1,...}} data dict to options.timeRange.
  #timeRangeFilterRunKeyed(options) {
    if (!options?.timeRange) return '';
    const { start, end } = options.timeRange;
    return `
# Apply time range filter per run
for _run_id in list(data.keys()):
    _run = data[_run_id]
    _time_arr = _run.get('time', [])
    _indices = [i for i, t in enumerate(_time_arr) if t >= ${start} and t <= ${end}]
    for _key in list(_run.keys()):
        if isinstance(_run[_key], list) and len(_run[_key]) == len(_time_arr):
            _run[_key] = [_run[_key][i] for i in _indices]
`;
  }

  /**
   * Generate Python script for visualization
   */
  generatePythonVisualizationScript(type, dataPath, outputPath, variables, options) {
    switch (type) {
      case 'time_series':
        return this.generateTimeSeriesScript(dataPath, outputPath, variables, options);
      case 'phase_portrait':
        return this.generatePhasePortraitScript(dataPath, outputPath, variables, options);
      case 'feedback_dominance':
        return this.generateFeedbackDominanceScript(dataPath, outputPath, variables, options);
      case 'comparison':
        return this.generateComparisonScript(dataPath, outputPath, variables, options);
      case 'confidence_interval':
        return this.generateConfidenceIntervalScript(dataPath, outputPath, variables, options);
      default:
        throw new Error(`Unknown visualization type: ${type}`);
    }
  }

  /**
   * Generate time series plot script
   */
  generateTimeSeriesScript(dataPath, outputPath, variables, options) {
    const bandPalette = ['#4e79a7','#f28e2b','#59a14f','#e15759','#76b7b2','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac'];
    let paletteIdx = 0;
    const labelColorMap = {};
    const periods = (options.highlightPeriods || []).map(period => {
      if (!labelColorMap[period.label]) {
        labelColorMap[period.label] = period.color || bandPalette[paletteIdx++ % bandPalette.length];
      }
      return { ...period, color: labelColorMap[period.label] };
    });

    const highlightPeriodsCode = periods.map(p =>
      `\nax.axvspan(${p.start}, ${p.end}, alpha=0.2, color='${p.color}', zorder=0, linewidth=0)`
    ).join('');

    const uniqueLabelPeriods = Object.entries(labelColorMap).map(([label, color]) => ({ label, color }));
    const legendCode = uniqueLabelPeriods.length > 0
      ? `import matplotlib.patches as mpatches
band_handles = [${uniqueLabelPeriods.map(p => `mpatches.Patch(facecolor='${p.color}', alpha=0.6, label='${p.label}')`).join(', ')}]
line_handles = [l for l in ax.lines if not l.get_label().startswith('_')]
ax.legend(handles=band_handles + line_handles, loc='best')`
      : `ax.legend(loc='best')`;

    const su = options.seriesUnits || {};
    const unitValues = variables.map(v => su[v]).filter(Boolean);
    const sharedUnit = unitValues.length === variables.length && new Set(unitValues).size === 1 ? unitValues[0] : null;
    const yAxisLabel = sharedUnit ? `Value (${sharedUnit})` : 'Value';

    return `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import json
import warnings
warnings.filterwarnings('ignore')

# Load data
with open('${dataPath}', 'r') as f:
    data = json.load(f)
${this.#timeRangeFilterFlat(options)}
fig, ax = plt.subplots(figsize=(${(options.width || 800)/100}, ${(options.height || 600)/100}))

# Background highlight periods (drawn first so lines render on top)
${highlightPeriodsCode}

# Plot each variable
${variables.map(v => {
      const units = su[v];
      const label = units ? `${v.replaceAll('_', ' ')} (${units})` : v.replaceAll('_', ' ');
      return `\nax.plot(data['time'], data['${v}'], label='${label}', linewidth=2, zorder=3)`;
    }).join('')}

# Styling
ax.set_xlabel('Time (${options.timeUnits || 'units'})', fontsize=12)
ax.set_ylabel('${yAxisLabel}', fontsize=12)
ax.set_title('${options.title || 'Time Series'}', fontsize=14, fontweight='bold')
${legendCode}
ax.grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig('${outputPath}', format='svg', bbox_inches='tight')
plt.close()
print('Visualization saved')
`.trim();
  }

  /**
   * Generate phase portrait script
   */
  generatePhasePortraitScript(dataPath, outputPath, variables, options) {
    const [xVar, yVar] = variables;
    const su = options.seriesUnits || {};
    const xLabel = su[xVar] ? `${xVar.replaceAll('_', ' ')} (${su[xVar]})` : xVar.replaceAll('_', ' ');
    const yLabel = su[yVar] ? `${yVar.replaceAll('_', ' ')} (${su[yVar]})` : yVar.replaceAll('_', ' ');
    const timeLabel = options.timeUnits ? `Time (${options.timeUnits})` : 'Time';
    return `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import json
import warnings
warnings.filterwarnings('ignore')

with open('${dataPath}', 'r') as f:
    data = json.load(f)
${this.#timeRangeFilterFlat(options)}
fig, ax = plt.subplots(figsize=(8, 6))

time = np.array(data['time'])
x = np.array(data['${xVar}'])
y = np.array(data['${yVar}'])

scatter = ax.scatter(x, y, c=time, cmap='viridis', s=20, alpha=0.6)
ax.plot(x, y, 'k-', alpha=0.3, linewidth=0.5)

ax.scatter(x[0], y[0], c='green', s=100, marker='o', label='Start', zorder=5)
ax.scatter(x[-1], y[-1], c='red', s=100, marker='s', label='End', zorder=5)

ax.set_xlabel('${xLabel}', fontsize=12)
ax.set_ylabel('${yLabel}', fontsize=12)
ax.set_title('Phase Portrait: ${yVar.replaceAll('_', ' ')} vs ${xVar.replaceAll('_', ' ')}', fontsize=14, fontweight='bold')
ax.legend()
ax.grid(True, alpha=0.3)

cbar = plt.colorbar(scatter, ax=ax)
cbar.set_label('${timeLabel}', fontsize=10)

plt.tight_layout()
plt.savefig('${outputPath}', format='svg', bbox_inches='tight')
plt.close()
print('Visualization saved')
`.trim();
  }

  /**
   * Generate feedback dominance script (stacked area chart)
   *
   * Expected format:
   * - data: { time: [...], loopId1: [...], loopId2: [...], ... }
   * - variables: ['loopId1', 'loopId2', ...]
   * - options.highlightPeriods: [{ loopIds: [...], startTime: x, endTime: y, label: '...', color: '...' }, ...]
   */
  generateFeedbackDominanceScript(dataPath, outputPath, variables, options) {
    // Generate the loop variable names for Python script
    const loopVarsList = variables.map(v => `'${v}'`).join(', ');

    return `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker
import numpy as np
import json
import warnings
warnings.filterwarnings('ignore')

with open('${dataPath}', 'r') as f:
    data = json.load(f)
${this.#timeRangeFilterFlat(options)}
fig, ax = plt.subplots(figsize=(${(options.width || 800)/100}, ${(options.height || 600)/100}))

# Get time array
time = data.get('time', [])

# Loop IDs to plot (from variables parameter)
loop_ids = [${loopVarsList}]

# Collect loop data
loop_data = []
loop_labels = []

for loop_id in loop_ids:
    if loop_id in data:
        loop_values = data[loop_id]
        if loop_values and len(loop_values) > 0:
            loop_data.append(np.array(loop_values))
            loop_labels.append(loop_id)

# Create stacked area plot
if len(loop_data) > 0 and len(time) > 0:
    time = np.array(time)

    # Add highlight periods for dominant loops (from options.highlightPeriods)
    highlight_periods = ${JSON.stringify(options.highlightPeriods || [])}

    for period in highlight_periods:
        start_time = period.get('startTime', 0)
        end_time = period.get('endTime', 0)
        dominant_loops = period.get('loopIds', [])
        label = period.get('label', '')
        color = period.get('color', 'yellow')

        if start_time < end_time:
            # Create label from dominant loop IDs if not provided
            if not label and dominant_loops:
                label = ', '.join(dominant_loops[:3])
                if len(dominant_loops) > 3:
                    label += f' (+{len(dominant_loops)-3} more)'

            # Add background shading for this period
            ax.axvspan(start_time, end_time, alpha=0.15, color=color,
                      label=f'Dominant: {label}' if label else 'Dominant period', zorder=0)

    # Plot the stacked areas on top of background shading
    colors = plt.cm.tab10(np.linspace(0, 1, len(loop_data)))
    ax.stackplot(time, *loop_data, labels=loop_labels, colors=colors, alpha=0.7)

    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda y, _: f'{y:.0f}%'))
    ax.set_xlabel('Time (${options.timeUnits || 'units'})', fontsize=12)
    ax.set_ylabel('Percent of Behavior Explained', fontsize=12)
    ax.set_title('${options.title || 'Feedback Loop Dominance Over Time'}', fontsize=14, fontweight='bold')
    ax.legend(loc='upper left', bbox_to_anchor=(1.02, 1), borderaxespad=0)
    ax.grid(True, alpha=0.3)
else:
    ax.text(0.5, 0.5, 'No feedback loop data available',
            ha='center', va='center', transform=ax.transAxes, fontsize=12)

plt.tight_layout()
plt.savefig('${outputPath}', format='svg', bbox_inches='tight')
plt.close()
print('Visualization saved')
`.trim();
  }

  /**
   * Generate comparison script
   */
  generateComparisonScript(dataPath, outputPath, variables, options) {
    // For comparison, variables is expected to be a single variable name
    const variable = Array.isArray(variables) ? variables[0] : variables;

    return `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import json
import warnings
warnings.filterwarnings('ignore')

with open('${dataPath}', 'r') as f:
    data = json.load(f)
${this.#timeRangeFilterRunKeyed(options)}
fig, ax = plt.subplots(figsize=(${(options.width || 800)/100}, ${(options.height || 600)/100}))

colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf']
line_styles = ['-', '--', '-.', ':']

# Run-keyed format: { runId: { time: [...], varName: [...], ... } }
run_items = []
for run_id, run_data in data.items():
    run_items.append((run_id, run_data.get('time', []), run_data.get('${variable}', [])))

for idx, (label, time_data, values) in enumerate(run_items):
    color = colors[idx % len(colors)]
    line_style = line_styles[0] if idx == 0 else line_styles[(idx % (len(line_styles)-1)) + 1]
    ax.plot(time_data, values, label=label, color=color, linestyle=line_style, linewidth=2)

ax.set_xlabel('Time', fontsize=12)
ax.set_ylabel('${options.seriesUnits?.[variable] ? `${variable} (${options.seriesUnits[variable]})` : variable}', fontsize=12)
ax.set_title('${options.title || `Comparison: ${variable}`}', fontsize=14, fontweight='bold')
ax.legend(loc='best')
ax.grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig('${outputPath}', format='svg', bbox_inches='tight')
plt.close()
print('Visualization saved')
`.trim();
  }

  /**
   * Generate confidence interval plot script.
   *
   * Expected data format: run-keyed { runId: { time: [...], var1: [...], ... } }.
   * For each variable, the script computes the median and configured percentile bands
   * across runs at each time point. Defaults: median + 50% (25–75) + 95% (2.5–97.5) bands.
   */
  generateConfidenceIntervalScript(dataPath, outputPath, variables, options) {
    const intervals = (options.confidenceIntervals && options.confidenceIntervals.length > 0)
      ? options.confidenceIntervals
      : [50, 95];
    const showMedian = options.showMedian !== false;

    const su = options.seriesUnits || {};
    const unitValues = variables.map(v => su[v]).filter(Boolean);
    const sharedUnit = unitValues.length === variables.length && new Set(unitValues).size === 1 ? unitValues[0] : null;
    const yAxisLabel = sharedUnit ? `Value (${sharedUnit})` : 'Value';

    const variableLabels = variables.map(v => su[v] ? `${v.replaceAll('_', ' ')} (${su[v]})` : v.replaceAll('_', ' '));

    return `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import json
import warnings
warnings.filterwarnings('ignore')

with open('${dataPath}', 'r') as f:
    data = json.load(f)
${this.#timeRangeFilterRunKeyed(options)}
fig, ax = plt.subplots(figsize=(${(options.width || 800)/100}, ${(options.height || 600)/100}))

variables = ${JSON.stringify(variables)}
variable_labels = ${JSON.stringify(variableLabels)}
intervals = ${JSON.stringify(intervals)}
show_median = ${showMedian ? 'True' : 'False'}

palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf']

run_ids = list(data.keys())
if len(run_ids) == 0:
    raise SystemExit('No runs found')

# Build reference time grid from the first run that has a usable 'time' array.
ref_time = None
for rid in run_ids:
    t = data[rid].get('time')
    if isinstance(t, list) and len(t) > 0:
        ref_time = np.array(t, dtype=float)
        break
if ref_time is None or len(ref_time) == 0:
    raise SystemExit('No usable time array found in any run.')

# Draw widest band first (most transparent), narrower bands on top (more opaque)
intervals_sorted = sorted(intervals, reverse=True)

plotted_vars = []
skipped_vars = []

for var_idx, var in enumerate(variables):
    color = palette[var_idx % len(palette)]
    label = variable_labels[var_idx]

    series = []
    for rid in run_ids:
        run = data[rid]
        values = run.get(var)
        run_time = run.get('time')
        if values is None or run_time is None:
            continue
        if len(values) != len(run_time):
            continue
        v_arr = np.array(values, dtype=float)
        t_arr = np.array(run_time, dtype=float)
        # Interpolate this run's values onto the reference time grid so cross-run
        # percentiles can be computed even when grids differ slightly.
        if len(t_arr) == len(ref_time) and np.array_equal(t_arr, ref_time):
            series.append(v_arr)
        else:
            series.append(np.interp(ref_time, t_arr, v_arr))
    if not series:
        skipped_vars.append(var)
        continue
    arr = np.array(series)
    plotted_vars.append(var)

    for band_idx, ci in enumerate(intervals_sorted):
        lower_p = (100 - ci) / 2.0
        upper_p = 100 - lower_p
        lo = np.percentile(arr, lower_p, axis=0)
        hi = np.percentile(arr, upper_p, axis=0)
        if len(intervals_sorted) > 1:
            alpha = 0.15 + 0.20 * (band_idx / (len(intervals_sorted) - 1))
        else:
            alpha = 0.25
        band_label = f'{label} — {ci:g}% CI' if len(variables) > 1 else f'{ci:g}% CI'
        ax.fill_between(ref_time, lo, hi, color=color, alpha=alpha, linewidth=0, label=band_label, zorder=2)

    if show_median:
        med = np.percentile(arr, 50, axis=0)
        med_label = f'{label} — median' if len(variables) > 1 else 'Median'
        ax.plot(ref_time, med, color=color, linewidth=2, label=med_label, zorder=5)

if not plotted_vars:
    raise SystemExit(
        f"No usable data for variables {variables}. "
        f"Checked {len(run_ids)} runs; none had matching time/values arrays for the requested variables."
    )

ax.set_xlabel('Time (${options.timeUnits || 'units'})', fontsize=12)
ax.set_ylabel('${yAxisLabel}', fontsize=12)
ax.set_title('${options.title || 'Confidence Intervals'}', fontsize=14, fontweight='bold')
ax.legend(loc='best')
ax.grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig('${outputPath}', format='svg', bbox_inches='tight')
plt.close()
print('Visualization saved')
`.trim();
  }

  /**
   * Execute a Python script.
   *
   * On Linux in production this process runs inside a bwrap container, so the
   * OS-level mount namespace provides isolation — no additional Python-level
   * sandbox wrapper is needed. On macOS/Windows (dev) the worker spawner has
   * already emitted a prominent warning about the lack of sandboxing.
   */
  async executePythonScript(scriptPath) {
    const validatedPath = this.validatePath(scriptPath);

    return new Promise((resolve, reject) => {
      const pythonProcess = spawn('python3', [validatedPath], {
        cwd: this.resolvedTempDir,
        env: {
          PATH: process.env.PATH,
          HOME: this.resolvedTempDir,
          TMPDIR: this.resolvedTempDir,
        },
        timeout: 70000,
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => { stdout += data.toString(); });
      pythonProcess.stderr.on('data', (data) => { stderr += data.toString(); });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python script failed (code ${code}): ${stderr}`));
        } else {
          resolve(stdout);
        }
      });

      pythonProcess.on('error', (err) => {
        reject(new Error(`Failed to spawn Python: ${err.message}`));
      });
    });
  }
}
