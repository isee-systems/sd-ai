import { randomBytes } from 'crypto';
import { join } from 'path';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import { LLMWrapper } from '../../utilities/LLMWrapper.js';

/**
 * VisualizationEngine
 * Creates visualizations using Python/matplotlib
 *
 * Key Features:
 * - Always returns base64 encoded PNG images
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
  }

  /**
   * Generate a unique visualization ID
   */
  generateVizId() {
    return `viz_${randomBytes(8).toString('hex')}`;
  }

  /**
   * Create visualization - always returns base64 encoded PNG image
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
   * Create custom visualization using AI to write Python/matplotlib code - returns base64 image only
   */
  async createAICustomVisualization(data, variables, options) {
    const vizId = this.generateVizId();
    const scriptPath = join(this.sessionTempDir, `visualization-${vizId}.py`);
    const dataPath = join(this.sessionTempDir, `data-${vizId}.json`);
    const outputPath = join(this.sessionTempDir, `visualization-${vizId}.png`);

    let base64Image = null;
    let error = null;

    try {
      // 1. Write data to temp file
      writeFileSync(dataPath, JSON.stringify(data));

      // 2. Generate Python script using AI
      const pythonScript = await this.generateAIVisualizationScript(
        dataPath, outputPath, data, variables, options
      );
      writeFileSync(scriptPath, pythonScript);

      // 3. Execute Python script
      await this.executePythonScript(scriptPath);

      // 4. Read generated image and return as base64 string only
      const imageBuffer = readFileSync(outputPath);
      base64Image = imageBuffer.toString('base64');

    } catch (err) {
      error = err;
      console.error(`Failed to create AI custom visualization ${vizId}:`, err);
    } finally {
      // ALWAYS cleanup temp files
      this.cleanupVisualizationFiles(vizId);

      if (error) {
        throw error;
      }
    }

    return base64Image;
  }

  /**
   * Use AI to generate custom Python visualization script
   */
  async generateAIVisualizationScript(dataPath, outputPath, data, variables, options) {
    const llm = new LLMWrapper();

    // Prepare data description
    const dataDescription = options.dataDescription || this.describeData(data, variables);

    // Prepare visualization requirements
    const visualizationGoal = options.visualizationGoal || options.title || 'Visualize the data in an insightful way';

    const systemPrompt = `You are an expert data visualization specialist using Python and matplotlib.
Generate Python code to create visualizations based on user requirements.

Requirements:
- Use matplotlib with Agg backend (no display)
- Load data from JSON file
- Save figure to specified output path
- Create clear, professional visualizations
- Include appropriate labels, titles, legends
- Use good color schemes
- Handle edge cases gracefully`;

    const userPrompt = `Generate Python code to visualize this data:

## Data Description
${dataDescription}

## Data Structure
The data is available in JSON format at: ${dataPath}
Variables available: ${variables.join(', ')}
Time series data structure: {time: [...], ${variables.map(v => `'${v}': [...]`).join(', ')}}

## Visualization Goal
${visualizationGoal}

${options.customRequirements ? `\n## Additional Requirements\n${options.customRequirements}` : ''}

## Output Requirements
- Save the figure to: ${outputPath}
- Figure size: ${(options.width || 800)/100} x ${(options.height || 600)/100} inches
- DPI: 100
- Use matplotlib.use('Agg') backend
- Close figure after saving

Generate ONLY the Python code, no explanations. The code should be complete and ready to execute.`;

    try {
      const response = await llm.generateResponse({
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.3,
        model: LLMWrapper.NON_BUILD_DEFAULT_MODEL
      });

      // Extract Python code from response
      let pythonCode = response.trim();

      // Remove markdown code blocks if present
      if (pythonCode.startsWith('```python')) {
        pythonCode = pythonCode.replace(/```python\n/, '').replace(/\n```$/, '');
      } else if (pythonCode.startsWith('```')) {
        pythonCode = pythonCode.replace(/```\n/, '').replace(/\n```$/, '');
      }

      return pythonCode;

    } catch (err) {
      console.error('Failed to generate AI visualization script:', err);
      throw new Error(`AI visualization generation failed: ${err.message}`);
    }
  }

  /**
   * Describe data for AI to understand
   */
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
   * Create visualization using Python (matplotlib) - returns base64 image only
   */
  async createVisualizationWithPython(type, data, variables, options) {
    const vizId = this.generateVizId();
    const scriptPath = join(this.sessionTempDir, `visualization-${vizId}.py`);
    const dataPath = join(this.sessionTempDir, `data-${vizId}.json`);
    const outputPath = join(this.sessionTempDir, `visualization-${vizId}.png`);

    let base64Image = null;
    let error = null;

    try {
      // 1. Write data to temp file
      writeFileSync(dataPath, JSON.stringify(data));

      // 2. Generate Python script
      const pythonScript = this.generatePythonVisualizationScript(
        type, dataPath, outputPath, variables, options
      );
      writeFileSync(scriptPath, pythonScript);

      // 3. Execute Python script
      await this.executePythonScript(scriptPath);

      // 4. Read generated image and return as base64 string only
      const imageBuffer = readFileSync(outputPath);
      base64Image = imageBuffer.toString('base64');

    } catch (err) {
      error = err;
      console.error(`Failed to create Python visualization ${vizId}:`, err);
    } finally {
      // ALWAYS cleanup temp files
      this.cleanupVisualizationFiles(vizId);

      if (error) {
        throw error;
      }
    }

    return base64Image;
  }

  /**
   * Cleanup visualization temp files
   */
  cleanupVisualizationFiles(vizId) {
    const filesToDelete = [
      join(this.sessionTempDir, `visualization-${vizId}.py`),
      join(this.sessionTempDir, `data-${vizId}.json`),
      join(this.sessionTempDir, `visualization-${vizId}.png`)
    ];

    for (const file of filesToDelete) {
      try {
        if (existsSync(file)) {
          unlinkSync(file);
        }
      } catch (err) {
        console.warn(`Failed to delete temp file ${file}:`, err.message);
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
import json
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')

# Load data
with open('${dataPath}', 'r') as f:
    data = json.load(f)

# Create figure
fig, ax = plt.subplots(figsize=(${(options.width || 800)/100}, ${(options.height || 600)/100}), dpi=100)

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
plt.savefig('${outputPath}', dpi=100, bbox_inches='tight')
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
import json
import matplotlib.pyplot as plt
import numpy as np
import matplotlib
matplotlib.use('Agg')

with open('${dataPath}', 'r') as f:
    data = json.load(f)

fig, ax = plt.subplots(figsize=(8, 6), dpi=100)

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
plt.savefig('${outputPath}', dpi=100, bbox_inches='tight')
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
import json
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')

with open('${dataPath}', 'r') as f:
    data = json.load(f)

fig, ax = plt.subplots(figsize=(${(options.width || 800)/100}, ${(options.height || 600)/100}), dpi=100)

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
plt.savefig('${outputPath}', dpi=100, bbox_inches='tight')
plt.close()
print('Visualization saved')
`.trim();
  }

  /**
   * Execute Python script
   */
  async executePythonScript(scriptPath) {
    return new Promise((resolve, reject) => {
      const python = spawn('python3', [scriptPath]);

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python script failed (code ${code}): ${stderr}`));
        } else {
          resolve(stdout);
        }
      });

      python.on('error', (err) => {
        reject(new Error(`Failed to spawn Python: ${err.message}`));
      });
    });
  }
}
