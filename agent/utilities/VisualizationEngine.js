import { randomBytes } from 'crypto';
import { join, resolve, normalize, dirname } from 'path';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
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

    // Cache LLM wrapper to avoid recreating it for each visualization
    this.llm = new LLMWrapper();
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
    // Comparison format: { runs: [{ data: { time, varName } }] }
    // Each run is normalized independently — runs may have different lengths.
    if (data?.runs && Array.isArray(data.runs)) {
      const normalizedRuns = data.runs.map((run, idx) => {
        const normalizedRunData = this.#normalizeRunData(run.data, variables, `run[${idx}]`);
        return normalizedRunData === run.data ? run : { ...run, data: normalizedRunData };
      });
      return { ...data, runs: normalizedRuns };
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

    const dataDescription = options.dataDescription || this.buildSchemaDescription(actualDataPath, schemaData);
    const visualizationGoal = options.visualizationGoal || options.title || 'Visualize the data in an insightful way';

    const systemPrompt = `You are a Python matplotlib code generator. Generate working Python visualization code.

Requirements:
- Use matplotlib with Agg backend (set BEFORE importing pyplot)
- Load JSON data and create the visualization
- Save as SVG using plt.savefig with format='svg'
- Include labels, titles, legends
- Make it clear and professional

Data handling:
- Always read data from the provided file path at runtime — never invent, assume, or hardcode data values
- Use the exact field paths from the schema provided — do not guess field names

Matplotlib rules — these are known sources of errors, follow them exactly:
- Never pass fontweight to ax.plot() or ax.scatter() — it is not a valid kwarg for Line2D or PathCollection
- ax.annotate ha= only accepts 'left', 'right', 'center' — never 'top' or 'bottom'
- ax.annotate va= accepts 'top', 'bottom', 'center', 'baseline' — never 'left' or 'right'
- Use fig.subplots_adjust() instead of plt.tight_layout()

Composing multiple chart types (background bands + line overlay, stacked area + secondary axis, etc.):
- Draw background period bands with ax.axvspan(zorder=0, linewidth=0)
- Draw overlaid lines at zorder=3 or higher
- Build legends manually using matplotlib.patches.Patch and matplotlib.lines.Line2D rather than relying on automatic label collection`;

    const userPrompt = `Generate Python code for this visualization:

Goal: ${visualizationGoal}
Output: ${outputPath}
Size: ${(options.width || 800)/100}x${(options.height || 600)/100} inches

${dataDescription}

${options.customRequirements ? `Requirements: ${options.customRequirements}\n` : ''}
Required:
1. Import order: matplotlib.use('Agg') BEFORE import matplotlib.pyplot
2. Suppress warnings: warnings.filterwarnings('ignore')
3. Save with: plt.savefig(path, format='svg', bbox_inches='tight')

Generate ONLY working Python code, no explanations.`;

    try {
      // Get LLM parameters with lower temperature for faster, more deterministic responses
      const { underlyingModel, temperature } = this.llm.getLLMParameters(0.1);

      // Create messages array
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const response = await this.llm.createChatCompletion(
        messages,
        underlyingModel,
        null, // no zodSchema
        temperature
      );

      // Extract Python code from response content
      let pythonCode = response.content.trim();

      // Remove markdown code blocks if present
      if (pythonCode.startsWith('```python')) {
        pythonCode = pythonCode.replace(/```python\n/, '').replace(/\n```$/, '');
      } else if (pythonCode.startsWith('```')) {
        pythonCode = pythonCode.replace(/```\n/, '').replace(/\n```$/, '');
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
      default:
        throw new Error(`Unknown visualization type: ${type}`);
    }
  }

  /**
   * Generate time series plot script
   */
  generateTimeSeriesScript(dataPath, outputPath, variables, options) {
    const highlightPeriodsCode = (options.highlightPeriods || []).map(period => `
ax.axvspan(${period.start}, ${period.end}, alpha=0.2, color='${period.color || 'yellow'}', label='${period.label}')
`).join('');

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

fig, ax = plt.subplots(figsize=(${(options.width || 800)/100}, ${(options.height || 600)/100}))

# Plot each variable
${variables.map((v, idx) => `
ax.plot(data['time'], data['${v}'], label='${v}', linewidth=2)
`).join('')}

# Styling
ax.set_xlabel('Time (${options.timeUnits || 'units'})', fontsize=12)
ax.set_ylabel('Value', fontsize=12)
ax.set_title('${options.title || 'Time Series'}', fontsize=14, fontweight='bold')
ax.legend(loc='best')
ax.grid(True, alpha=0.3)

# Highlight periods
${highlightPeriodsCode}

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

fig, ax = plt.subplots(figsize=(8, 6))

time = np.array(data['time'])
x = np.array(data['${xVar}'])
y = np.array(data['${yVar}'])

scatter = ax.scatter(x, y, c=time, cmap='viridis', s=20, alpha=0.6)
ax.plot(x, y, 'k-', alpha=0.3, linewidth=0.5)

ax.scatter(x[0], y[0], c='green', s=100, marker='o', label='Start', zorder=5)
ax.scatter(x[-1], y[-1], c='red', s=100, marker='s', label='End', zorder=5)

ax.set_xlabel('${xVar}', fontsize=12)
ax.set_ylabel('${yVar}', fontsize=12)
ax.set_title('Phase Portrait: ${yVar} vs ${xVar}', fontsize=14, fontweight='bold')
ax.legend()
ax.grid(True, alpha=0.3)

cbar = plt.colorbar(scatter, ax=ax)
cbar.set_label('Time', fontsize=10)

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
import numpy as np
import json
import warnings
warnings.filterwarnings('ignore')

with open('${dataPath}', 'r') as f:
    data = json.load(f)

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

    ax.set_xlabel('Time (${options.timeUnits || 'units'})', fontsize=12)
    ax.set_ylabel('Loop Dominance', fontsize=12)
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

fig, ax = plt.subplots(figsize=(${(options.width || 800)/100}, ${(options.height || 600)/100}))

runs = data.get('runs', [])
colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf']
line_styles = ['-', '--', '-.', ':']

for idx, run in enumerate(runs):
    run_data = run.get('data', {})
    label = run.get('label', run.get('runId', f'Run {idx+1}'))
    color = colors[idx % len(colors)]
    line_style = line_styles[0] if idx == 0 else line_styles[(idx % (len(line_styles)-1)) + 1]

    ax.plot(run_data.get('time', []), run_data.get('${variable}', []),
            label=label, color=color, linestyle=line_style, linewidth=2)

ax.set_xlabel('Time', fontsize=12)
ax.set_ylabel('${variable}', fontsize=12)
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
