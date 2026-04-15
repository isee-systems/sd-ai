import { randomBytes } from 'crypto';
import { join } from 'path';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import { LLMWrapper } from '../../utilities/LLMWrapper.js';

/**
 * VisualizationEngine
 * Creates visualizations using Plotly (default) or Python/matplotlib
 *
 * Key Features:
 * - Plotly JSON specs (no temp files needed)
 * - Python/matplotlib for advanced visualizations
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
   * Create visualization (delegates to Plotly, Python, or AI-custom)
   */
  async createVisualization(type, data, variables, options = {}) {
    const usePython = options.usePython || false;
    const useAICustom = options.useAICustom || false;

    if (useAICustom) {
      return await this.createAICustomVisualization(data, variables, options);
    } else if (usePython) {
      return await this.createVisualizationWithPython(type, data, variables, options);
    } else {
      return this.createPlotlyVisualization(type, data, variables, options);
    }
  }

  /**
   * Create custom visualization using AI to write Python/matplotlib code
   */
  async createAICustomVisualization(data, variables, options) {
    const vizId = this.generateVizId();
    const scriptPath = join(this.sessionTempDir, `visualization-${vizId}.py`);
    const dataPath = join(this.sessionTempDir, `data-${vizId}.json`);
    const outputPath = join(this.sessionTempDir, `visualization-${vizId}.png`);

    let vizMessage = null;
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

      // 4. Read generated image
      const imageBuffer = readFileSync(outputPath);
      const base64Image = imageBuffer.toString('base64');

      // 5. Create visualization message
      vizMessage = {
        visualizationId: vizId,
        title: options.title || 'Custom AI Visualization',
        description: options.description,
        format: 'image',
        data: {
          encoding: 'base64',
          mimeType: 'image/png',
          content: base64Image,
          width: options.width || 800,
          height: options.height || 600
        },
        metadata: {
          createdBy: 'ai-custom',
          variables: variables,
          ...options.metadata
        }
      };

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

    return vizMessage;
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
   * Create visualization using Python (matplotlib/plotly)
   */
  async createVisualizationWithPython(type, data, variables, options) {
    const vizId = this.generateVizId();
    const scriptPath = join(this.sessionTempDir, `visualization-${vizId}.py`);
    const dataPath = join(this.sessionTempDir, `data-${vizId}.json`);
    const outputPath = join(this.sessionTempDir, `visualization-${vizId}.png`);

    let vizMessage = null;
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

      // 4. Read generated image
      const imageBuffer = readFileSync(outputPath);
      const base64Image = imageBuffer.toString('base64');

      // 5. Create visualization message
      vizMessage = {
        visualizationId: vizId,
        title: options.title || `${type} Visualization`,
        description: options.description,
        format: 'image',
        data: {
          encoding: 'base64',
          mimeType: 'image/png',
          content: base64Image,
          width: options.width || 800,
          height: options.height || 600
        },
        metadata: {
          createdBy: 'agent',
          type: type,
          variables: variables,
          ...options.metadata
        }
      };

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

    return vizMessage;
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
      case 'feedback_dominance':
        return this.generateFeedbackDominanceScript(dataPath, outputPath, options);
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
   * Generate feedback dominance script
   */
  generateFeedbackDominanceScript(dataPath, outputPath, options) {
    return `
import json
import matplotlib.pyplot as plt
import numpy as np
import matplotlib
matplotlib.use('Agg')

with open('${dataPath}', 'r') as f:
    data = json.load(f)

fig, ax = plt.subplots(figsize=(10, 6), dpi=100)

loops = data['feedbackLoops']
time = None
bottom = None

for loop in loops:
    loop_data = loop.get('Percent of Model Behavior Explained By Loop', [])
    if not loop_data:
        continue

    t = [p['time'] for p in loop_data]
    values = [p['value'] for p in loop_data]

    if time is None:
        time = t
        bottom = np.zeros(len(time))

    ax.fill_between(time, bottom, bottom + np.array(values),
                     label=loop.get('name', 'Unknown'), alpha=0.7)
    bottom = bottom + np.array(values)

if 'dominantLoopsByPeriod' in data:
    for period in data['dominantLoopsByPeriod']:
        ax.axvline(period['startTime'], color='red', linestyle='--', alpha=0.5)
        mid_time = (period['startTime'] + period['endTime']) / 2
        ax.text(mid_time, 95, ', '.join(period['dominantLoops']),
                ha='center', va='top', fontsize=9,
                bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))

ax.set_xlabel('Time', fontsize=12)
ax.set_ylabel('% of Behavior Explained', fontsize=12)
ax.set_title('Feedback Loop Dominance', fontsize=14, fontweight='bold')
ax.set_ylim(0, 100)
ax.legend(loc='upper left', bbox_to_anchor=(1, 1))
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

  /**
   * Create Plotly visualization (no temp files needed)
   */
  createPlotlyVisualization(type, data, variables, options) {
    let plotlySpec;

    switch (type) {
      case 'time_series':
        plotlySpec = this.createTimeSeriesPlotly(data, variables, options);
        break;
      case 'phase_portrait':
        plotlySpec = this.createPhasePortraitPlotly(data, variables, options);
        break;
      case 'feedback_dominance':
        plotlySpec = this.createFeedbackDominancePlotly(data, options);
        break;
      case 'comparison':
        plotlySpec = this.createComparisonPlotly(data, variables, options);
        break;
      default:
        throw new Error(`Unknown visualization type: ${type}`);
    }

    return {
      visualizationId: this.generateVizId(),
      title: options.title || `${type} Visualization`,
      description: options.description,
      format: 'plotly',
      data: plotlySpec,
      metadata: {
        createdBy: 'agent',
        type: type,
        variables: variables,
        ...options.metadata
      }
    };
  }

  /**
   * Create time series Plotly spec
   */
  createTimeSeriesPlotly(data, variables, options) {
    const traces = variables.map((varName, idx) => ({
      x: data.time,
      y: data[varName],
      type: 'scatter',
      mode: 'lines',
      name: varName,
      line: {
        color: this.getColor(idx),
        width: 2
      }
    }));

    const shapes = (options.highlightPeriods || []).map(period => ({
      type: 'rect',
      xref: 'x',
      yref: 'paper',
      x0: period.start,
      x1: period.end,
      y0: 0,
      y1: 1,
      fillcolor: period.color || 'yellow',
      opacity: 0.2,
      line: { width: 0 }
    }));

    const annotations = (options.highlightPeriods || []).map(period => ({
      x: (period.start + period.end) / 2,
      y: 1,
      yref: 'paper',
      text: period.label,
      showarrow: false,
      bgcolor: period.color || 'yellow',
      opacity: 0.8
    }));

    return {
      data: traces,
      layout: {
        title: options.title || 'Time Series',
        xaxis: { title: `Time (${options.timeUnits || 'units'})` },
        yaxis: { title: 'Value' },
        showlegend: true,
        hovermode: 'x unified',
        shapes: shapes,
        annotations: annotations
      },
      config: {
        responsive: true,
        displayModeBar: true
      }
    };
  }

  /**
   * Create phase portrait Plotly spec
   */
  createPhasePortraitPlotly(data, variables, options) {
    const [xVar, yVar] = variables;

    return {
      data: [{
        x: data[xVar],
        y: data[yVar],
        type: 'scatter',
        mode: 'lines+markers',
        marker: {
          size: 4,
          color: data.time,
          colorscale: 'Viridis',
          showscale: true,
          colorbar: { title: 'Time' }
        },
        line: { width: 1 }
      }],
      layout: {
        title: `Phase Portrait: ${yVar} vs ${xVar}`,
        xaxis: { title: xVar },
        yaxis: { title: yVar },
        hovermode: 'closest'
      },
      config: {
        responsive: true,
        displayModeBar: true
      }
    };
  }

  /**
   * Create feedback dominance Plotly spec
   */
  createFeedbackDominancePlotly(data, options) {
    const loops = data.feedbackLoops || [];

    const traces = loops.map((loop, idx) => {
      const loopData = loop['Percent of Model Behavior Explained By Loop'] || [];
      return {
        x: loopData.map(p => p.time),
        y: loopData.map(p => p.value),
        type: 'scatter',
        mode: 'lines',
        name: loop.name || `Loop ${idx + 1}`,
        stackgroup: 'one',
        fillcolor: this.getColor(idx)
      };
    });

    const shapes = (data.dominantLoopsByPeriod || []).map(period => ({
      type: 'line',
      x0: period.startTime,
      x1: period.startTime,
      y0: 0,
      y1: 100,
      line: { color: 'red', width: 1, dash: 'dot' }
    }));

    const annotations = (data.dominantLoopsByPeriod || []).map(period => ({
      x: (period.startTime + period.endTime) / 2,
      y: 95,
      text: `Dominant: ${period.dominantLoops.join(', ')}`,
      showarrow: false,
      bgcolor: 'white',
      bordercolor: 'red'
    }));

    return {
      data: traces,
      layout: {
        title: 'Feedback Loop Dominance Over Time',
        xaxis: { title: 'Time' },
        yaxis: { title: '% of Behavior Explained', range: [0, 100] },
        showlegend: true,
        shapes: shapes,
        annotations: annotations
      },
      config: {
        responsive: true,
        displayModeBar: true
      }
    };
  }

  /**
   * Create comparison Plotly spec
   */
  createComparisonPlotly(data, variable, options) {
    const runsData = data.runs || [];

    const traces = runsData.map((run, idx) => ({
      x: run.data.time,
      y: run.data[variable],
      type: 'scatter',
      mode: 'lines',
      name: run.label || run.runId,
      line: {
        color: this.getColor(idx),
        width: 2,
        dash: idx > 0 ? 'dash' : 'solid'
      }
    }));

    return {
      data: traces,
      layout: {
        title: `Comparison: ${variable}`,
        xaxis: { title: 'Time' },
        yaxis: { title: variable },
        showlegend: true,
        hovermode: 'x unified'
      },
      config: {
        responsive: true,
        displayModeBar: true
      }
    };
  }

  /**
   * Color palette for consistent styling
   */
  getColor(index) {
    const colors = [
      '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
      '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
    ];
    return colors[index % colors.length];
  }
}
