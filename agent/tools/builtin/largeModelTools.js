import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createUpdateModelMessage } from '../../utilities/MessageProtocol.js';
import { generateRequestId, createSuccessResponse, createErrorResponse } from './toolHelpers.js';
import logger from '../../../utilities/logger.js';
import config from '../../../config.js';

/**
 * Read a specific section of the large model file
 */
export function createReadModelSectionTool(sessionManager, sessionId) {
  return {
    description: `Read a specific section of the large model file. Use this to inspect parts of the model without loading the entire thing.

Available sections:
- specs: simulation specifications (startTime, stopTime, dt, timeUnits, arrayDimensions).
  * arrayDimensions schema: [{type: "numeric"|"labels", name: string (singular, alphanumeric), size: number (positive integer), elements: string[] (element names)}]
  * All four fields (type, name, size, elements) are required for each dimension
  * type="numeric": elements auto-generated as ['1','2','3'...]
  * type="labels": elements are user-defined meaningful names like ['North','South','East','West']
- variables: array of variables with schema: {name, type (stock|flow|variable), equation, documentation, units, uniflow, inflows, outflows, dimensions, arrayEquations, crossLevelGhostOf, graphicalFunction}
- relationships: array of relationships with schema: {from, to, polarity (+|-|""), reasoning, polarityReasoning}
- modules: module hierarchy with schema: {name, parentModule}. IMPORTANT: The modules array only defines the hierarchical structure (which modules exist and their parent-child relationships). It does NOT tell you which variables belong to a module - variable membership is determined by the variable name prefix (e.g., "Finance.revenue" belongs to the Finance module).

Module handling:
- In modular models, variable names are module-qualified as "Module_Name.variable_name"
- To find variables in a module, use the moduleName filter (filters by name prefix)
- The modules section only shows the module hierarchy, not the contents

Array handling:
- Variables with the "dimensions" field are arrayed variables
- Array dimensions must be defined in specs.arrayDimensions BEFORE being referenced by variables
- Each dimension requires all four fields: type, name, size, elements
- Element-specific equations are in the "arrayEquations" field

Filtering:
- variableNames filter matches base names (e.g., "cost" matches "Module_1.cost", "Module_2.cost", and "cost")
- moduleName filter gets all variables from a specific module (by name prefix)
- usedInEquation filter finds all variables whose equations reference a given variable (case-insensitive, matches XMILE format with underscores)`,
    supportedModes: ['sfd', 'cld'],
    inputSchema: z.object({
      section: z.enum(['specs', 'variables', 'relationships', 'modules']).describe('Which section to read'),
      filter: z.object({
        variableNames: z.array(z.string()).optional().describe('Filter variables by base name (matches both qualified and unqualified names, e.g., "cost" matches "Module_1.cost", "Module_2.cost", and "cost")'),
        variableType: z.enum(['stock', 'flow', 'variable']).optional().describe('Filter variables by type'),
        moduleName: z.string().optional().describe('Filter variables by module (e.g., "Module_Name" - variable names are module-qualified as Module_Name.variable_name)'),
        usedInEquation: z.string().optional().describe('Find variables whose equations reference this variable (case-insensitive). Searches in both equation and arrayEquations fields.'),
        relationshipFrom: z.string().optional().describe('Filter relationships by source variable'),
        relationshipTo: z.string().optional().describe('Filter relationships by target variable'),
        limit: z.number().optional().describe('Limit number of results returned (default: 500)')
      }).optional().describe('Optional filters for variables/relationships/modules')
    }),
    handler: async ({ section, filter }) => {
      try {
        const sessionTempDir = sessionManager.getSessionTempDir(sessionId);
        const modelPath = join(sessionTempDir, 'model.sdjson');

        if (!existsSync(modelPath)) {
          return createErrorResponse('Error: Model file not found. The model may not have exceeded the token limit yet.');
        }

        const modelContent = readFileSync(modelPath, 'utf-8');
        const model = JSON.parse(modelContent);

        const limit = filter?.limit || 500;
        let result = {};

        switch (section) {
          case 'specs':
            result = model.specs || {};
            break;

          case 'variables':
            let variables = model.variables || [];

            // Apply filters (case-insensitive)
            if (filter?.variableNames && filter.variableNames.length > 0) {
              const lowerFilterNames = filter.variableNames.map(name => name.toLowerCase());
              variables = variables.filter(v => {
                const lowerName = v.name.toLowerCase();
                if (lowerFilterNames.includes(lowerName)) {
                  return true;
                }
                const baseName = v.name.includes('.') ? v.name.split('.').pop() : v.name;
                return lowerFilterNames.includes(baseName.toLowerCase());
              });
            }
            if (filter?.variableType) {
              variables = variables.filter(v => v.type === filter.variableType);
            }
            if (filter?.moduleName) {
              const modulePrefix = filter.moduleName.toLowerCase() + '.';
              variables = variables.filter(v => v.name.toLowerCase().startsWith(modulePrefix));
            }
            if (filter?.usedInEquation) {
              const searchTerm = filter.usedInEquation.replace(/ /g, '_').toLowerCase();
              variables = variables.filter(v => {
                if (v.equation && v.equation.toLowerCase().includes(searchTerm)) {
                  return true;
                }
                if (v.arrayEquations && Array.isArray(v.arrayEquations)) {
                  return v.arrayEquations.some(ae =>
                    ae.equation && ae.equation.toLowerCase().includes(searchTerm)
                  );
                }
                return false;
              });
            }

            const total = variables.length;
            variables = variables.slice(0, limit);

            variables = variables.map(v => ({
              ...v,
              name: v.name.replace(/ /g, '_')
            }));

            result = {
              variables,
              total,
              returned: variables.length,
              truncated: total > limit
            };
            break;

          case 'relationships':
            let relationships = model.relationships || [];

            if (filter?.relationshipFrom) {
              relationships = relationships.filter(r => r.from === filter.relationshipFrom);
            }
            if (filter?.relationshipTo) {
              relationships = relationships.filter(r => r.to === filter.relationshipTo);
            }

            const totalRels = relationships.length;
            relationships = relationships.slice(0, limit);

            result = {
              relationships,
              total: totalRels,
              returned: relationships.length,
              truncated: totalRels > limit
            };
            break;

          case 'modules':
            let modules = model.modules || [];

            if (filter?.moduleName) {
              modules = modules.filter(m => m.name === filter.moduleName);
            }

            result = {
              modules,
              total: modules.length
            };
            break;
        }

        return createSuccessResponse(result);
      } catch (error) {
        return createErrorResponse(`Failed to read model section: ${error.message}`, error);
      }
    }
  };
}

/**
 * Edit a specific section of the large model file
 */
export function createEditModelSectionTool(sessionManager, sessionId, sendToClient) {
  return {
    description: `Edit a specific section of the large model file. This allows you to modify parts of the model without loading the entire thing.

You can edit:
- specs: Update simulation specifications (startTime, stopTime, dt, timeUnits, arrayDimensions).
  * arrayDimensions schema: [{type: "numeric"|"labels", name: string (singular, alphanumeric), size: number (positive integer), elements: string[] (element names)}]
  * CRITICAL: All four fields (type, name, size, elements) are REQUIRED for each dimension
  * type="numeric": elements auto-generated as ['1','2','3'...] based on size
  * type="labels": elements are user-defined meaningful names like ['North','South','East','West']
  * When updating arrayDimensions, provide the COMPLETE array with all dimensions (it replaces the entire array)
- variables: Add, update, or remove specific variables.
  * Variable Schema: {name, type (stock|flow|variable), equation?, documentation?, units?, uniflow?, inflows?, outflows?, dimensions?, arrayEquations?, crossLevelGhostOf?, graphicalFunction?}
  * For ADD operation: Array of variable objects
    Example: [{name: "Population", type: "stock", equation: "1000"}, {name: "births", type: "flow", equation: "Population*0.1"}]
  * For UPDATE operation: Single variable object with name field (required) and fields to update
    Example: {name: "Population", equation: "2000", documentation: "Total population"}
  * For REMOVE operation: Array of variable name strings
    Example: ["Population", "births", "deaths"]
- relationships: Add, update, or remove relationships.
  * Relationship Schema: {from, to, polarity (+|-|""), reasoning?, polarityReasoning?}
  * For ADD operation: Array of relationship objects
    Example: [{from: "births", to: "Population", polarity: "+"}, {from: "deaths", to: "Population", polarity: "-"}]
  * For UPDATE operation: Single relationship object with from and to fields (required to identify which relationship to update)
    Example: {from: "births", to: "Population", polarity: "+", reasoning: "More births increase population"}
  * For REMOVE operation: Array of {from, to} objects identifying relationships to remove
    Example: [{from: "births", to: "Population"}, {from: "deaths", to: "Population"}]
- modules: Add, update, or remove modules.
  * Module Schema: {name, parentModule} where parentModule is null for root modules or a string module name for child modules
  * For ADD operation: Array of module objects
    Example: [{name: "Demographics", parentModule: null}, {name: "Births", parentModule: "Demographics"}]
  * For UPDATE operation: Complete array of all module objects (replaces entire module hierarchy)
    Example: [{name: "Demographics", parentModule: null}, {name: "Births", parentModule: "Demographics"}]
  * For REMOVE operation: Array of module name strings
    Example: ["Births", "Deaths"]
  * IMPORTANT: Modules array only defines hierarchy, NOT contents. Variable membership is by name prefix.

VARIABLE RENAMING:
- To rename a variable, use update operation with {name: "OldName", newName: "NewName"}
- The tool will automatically update ALL equations that reference the old variable name
- This includes equations in ALL variables across ALL modules
- References are updated case-insensitively using XMILE format (with underscores)

CRITICAL MODULE RULES:
- Variable names use ONLY their immediate owning module as prefix: "ModuleName.variableName"
- NEVER use full hierarchy path in variable names (WRONG: "Company.Sales.revenue", CORRECT: "Sales.revenue")
- Variables are qualified ONLY by their direct parent module, never by ancestor modules
- Cross-module references require ghost variables: use "crossLevelGhostOf" field pointing to source variable
- Ghost variables have empty equation field (equation = "")

CRITICAL EQUATION RULES:
- XMILE naming: Replace all spaces with underscores in variable references (e.g., "birth_rate" not "birth rate")
- Every variable MUST have either 'equation' OR 'arrayEquations' (never both, never neither)
- NEVER embed numerical constants directly in equations - create separate named variables for constants
- Stock-flow constraint: A flow can NEVER appear in BOTH inflows AND outflows of the same stock

CRITICAL ARRAY RULES:
- Array dimensions MUST be defined in specs.arrayDimensions BEFORE being referenced by variables
- Each dimension requires ALL FOUR fields: type ("numeric" or "labels"), name (singular, alphanumeric), size (positive integer), elements (array of element names)
- For arrayed variables, set "dimensions" field to array of dimension names that reference specs.arrayDimensions
- If all elements use SAME formula: provide 'equation' only
- If elements have DIFFERENT formulas: provide 'arrayEquations' for ALL elements (omit 'equation')
- For arrayed STOCKS: ALWAYS use 'arrayEquations' to specify initial values for each element
- SUM function syntax: ALWAYS use asterisk (*) for dimension being summed, NEVER the dimension name
  * WRONG: SUM(Revenue[region])
  * CORRECT: SUM(Revenue[*])
  * CRITICAL: Every SUM equation MUST contain at least one asterisk (*)

After editing, the model is validated and processed through the quantitative engine pipeline before updating the client.`,
    supportedModes: ['sfd', 'cld'],
    minModelTokens: config.agentMaxTokensForEngines,
    inputSchema: z.object({
      section: z.enum(['specs', 'variables', 'relationships', 'modules']).describe('Which section to edit'),
      operation: z.enum(['update', 'add', 'remove']).describe('Operation to perform'),
      data: z.union([
        // For specs update - object with optional spec fields
        z.object({
          startTime: z.number().optional(),
          stopTime: z.number().optional(),
          dt: z.number().optional(),
          timeUnits: z.string().optional(),
          arrayDimensions: z.array(z.object({
            type: z.enum(['numeric', 'labels']),
            name: z.string(),
            size: z.number().positive(),
            elements: z.array(z.string())
          })).optional()
        }),
        // For variables add - array of variables
        z.array(z.object({
          name: z.string(),
          type: z.enum(['stock', 'flow', 'variable']),
          equation: z.string().optional(),
          documentation: z.string().optional(),
          units: z.string().optional(),
          uniflow: z.boolean().optional(),
          inflows: z.array(z.string()).optional(),
          outflows: z.array(z.string()).optional(),
          dimensions: z.array(z.string()).optional(),
          arrayEquations: z.array(z.any()).optional(),
          crossLevelGhostOf: z.string().optional(),
          graphicalFunction: z.any().optional()
        })),
        // For variables update - single variable object with name (required)
        z.object({
          name: z.string(),
          newName: z.string().optional(),
          type: z.enum(['stock', 'flow', 'variable']).optional(),
          equation: z.string().optional(),
          documentation: z.string().optional(),
          units: z.string().optional(),
          uniflow: z.boolean().optional(),
          inflows: z.array(z.string()).optional(),
          outflows: z.array(z.string()).optional(),
          dimensions: z.array(z.string()).optional(),
          arrayEquations: z.array(z.any()).optional(),
          crossLevelGhostOf: z.string().optional(),
          graphicalFunction: z.any().optional()
        }),
        // For variables remove - array of strings
        z.array(z.string()),
        // For relationships add - array of relationships
        z.array(z.object({
          from: z.string(),
          to: z.string(),
          polarity: z.enum(['+', '-', '']).optional(),
          reasoning: z.string().optional(),
          polarityReasoning: z.string().optional()
        })),
        // For relationships update - single relationship object with from/to (required)
        z.object({
          from: z.string(),
          to: z.string(),
          polarity: z.enum(['+', '-', '']).optional(),
          reasoning: z.string().optional(),
          polarityReasoning: z.string().optional()
        }),
        // For relationships remove - array of {from, to} objects
        z.array(z.object({
          from: z.string(),
          to: z.string()
        })),
        // For modules add/update - array of modules
        z.array(z.object({
          name: z.string(),
          parentModule: z.string().nullable()
        }))
      ]).describe('The data for the operation. Format depends on section and operation - see description for details.')
    }),
    handler: async ({ section, operation, data }) => {
      // Centralized error handler
      const handleError = (errorMessage, error = null) => {
        return createErrorResponse(errorMessage, error);
      };

      try {
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        const sessionTempDir = sessionManager.getSessionTempDir(sessionId);
        const modelPath = join(sessionTempDir, 'model.sdjson');

        if (!existsSync(modelPath)) {
          return handleError('Error: Model file not found. The model may not have exceeded the token limit yet.');
        }

        const modelContent = readFileSync(modelPath, 'utf-8');
        const model = JSON.parse(modelContent);

        // Perform the edit operation
        switch (section) {
          case 'specs':
            if (operation === 'update') {
              model.specs = model.specs || {};
              if (data.startTime !== undefined) model.specs.startTime = data.startTime;
              if (data.stopTime !== undefined) model.specs.stopTime = data.stopTime;
              if (data.dt !== undefined) model.specs.dt = data.dt;
              if (data.timeUnits !== undefined) model.specs.timeUnits = data.timeUnits;

              if (data.arrayDimensions !== undefined) {
                if (Array.isArray(data.arrayDimensions)) {
                  for (const dim of data.arrayDimensions) {
                    if (!dim.type || !dim.name || dim.size === undefined || !Array.isArray(dim.elements)) {
                      return handleError(`Error: Array dimension "${dim.name || 'unknown'}" is missing required fields. All dimensions must have: type ("numeric" or "labels"), name (singular, alphanumeric), size (positive integer), and elements (array of element names).`);
                    }
                    if (dim.type !== 'numeric' && dim.type !== 'labels') {
                      return handleError(`Error: Array dimension "${dim.name}" has invalid type "${dim.type}". Must be "numeric" or "labels".`);
                    }
                    if (typeof dim.size !== 'number' || dim.size <= 0) {
                      return handleError(`Error: Array dimension "${dim.name}" size must be a positive integer, got: ${dim.size}`);
                    }
                    if (dim.elements.length !== dim.size) {
                      return handleError(`Error: Array dimension "${dim.name}" has size=${dim.size} but elements array has ${dim.elements.length} items. They must match.`);
                    }
                  }
                }
                model.specs.arrayDimensions = data.arrayDimensions;
              }
            }
            break;

          case 'variables':
            model.variables = model.variables || [];
            if (operation === 'add') {
              // Data must be an array of variable objects
              if (!Array.isArray(data)) {
                return handleError('Error: For variables add operation, data must be an array of variable objects. Example: [{name: "var1", type: "stock", equation: "100"}]');
              }
              const varsToAdd = data;
              const errors = [];
              for (let i = 0; i < varsToAdd.length; i++) {
                const v = varsToAdd[i];
                const varLabel = varsToAdd.length > 1 ? `Variable ${i + 1} (${v.name || 'unnamed'})` : `Variable "${v.name || 'unnamed'}"`;

                if (!v.name || !v.type) {
                  errors.push(`${varLabel}: Missing required fields. Must have "name" and "type".`);
                } else if (!['stock', 'flow', 'variable'].includes(v.type)) {
                  errors.push(`${varLabel}: Invalid type "${v.type}". Must be "stock", "flow", or "variable".`);
                }
              }

              if (errors.length > 0) {
                return handleError(`Error adding ${varsToAdd.length} variable(s):\n\n${errors.join('\n')}\n\nProvide an array of variable objects: [{name: "var1", type: "stock", equation: "100"}, {name: "var2", type: "variable", equation: "20"}]`);
              }

              model.variables.push(...varsToAdd);
            } else if (operation === 'update') {
              const varName = data.name;
              if (!varName) {
                return handleError('Error: Must specify "name" field to update a variable');
              }
              const index = model.variables.findIndex(v => v.name === varName);
              if (index >= 0) {
                const oldVariable = model.variables[index];
                const oldName = oldVariable.name;

                const isRenamed = data.newName && data.newName !== oldName;

                if (isRenamed) {
                  const newName = data.newName;
                  const oldNameXMILE = oldName.replace(/ /g, '_');
                  const newNameXMILE = newName.replace(/ /g, '_');

                  const varRegex = new RegExp(`\\b${oldNameXMILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');

                  for (const variable of model.variables) {
                    if (variable.equation && varRegex.test(variable.equation)) {
                      variable.equation = variable.equation.replace(varRegex, newNameXMILE);
                    }

                    if (variable.arrayEquations && Array.isArray(variable.arrayEquations)) {
                      for (const ae of variable.arrayEquations) {
                        if (ae.equation && varRegex.test(ae.equation)) {
                          ae.equation = ae.equation.replace(varRegex, newNameXMILE);
                        }
                      }
                    }
                  }

                  data.name = newName;
                  delete data.newName;
                }

                model.variables[index] = { ...model.variables[index], ...data };
              } else {
                return handleError(`Error: Variable "${varName}" not found`);
              }
            } else if (operation === 'remove') {
              if (!Array.isArray(data)) {
                return handleError('Error: For variables remove operation, data must be an array of variable name strings. Example: ["var1", "var2"]');
              }
              model.variables = model.variables.filter(v => !data.includes(v.name));
            }
            break;

          case 'relationships':
            model.relationships = model.relationships || [];
            if (operation === 'add') {
              if (!Array.isArray(data)) {
                return handleError('Error: For relationships add operation, data must be an array of relationship objects. Example: [{from: "var1", to: "var2", polarity: "+"}]');
              }
              const relsToAdd = data;
              for (const r of relsToAdd) {
                if (!r.from || !r.to) {
                  return handleError('Error: Relationships must have "from" and "to" fields');
                }
                if (r.polarity !== undefined && !['+', '-', ''].includes(r.polarity)) {
                  return handleError(`Error: Relationship polarity must be "+", "-", or "", got "${r.polarity}"`);
                }
              }
              model.relationships.push(...relsToAdd);
            } else if (operation === 'update') {
              if (!data.from || !data.to) {
                return handleError('Error: Must specify "from" and "to" fields to update a relationship');
              }
              const index = model.relationships.findIndex(r => r.from === data.from && r.to === data.to);
              if (index >= 0) {
                model.relationships[index] = { ...model.relationships[index], ...data };
              } else {
                return handleError(`Error: Relationship from "${data.from}" to "${data.to}" not found`);
              }
            } else if (operation === 'remove') {
              if (!Array.isArray(data)) {
                return handleError('Error: For relationships remove operation, data must be an array of {from, to} objects. Example: [{from: "var1", to: "var2"}]');
              }
              model.relationships = model.relationships.filter(r =>
                !data.some(rem => rem.from === r.from && rem.to === r.to)
              );
            }
            break;

          case 'modules':
            model.modules = model.modules || [];
            if (operation === 'update') {
              if (!Array.isArray(data)) {
                return handleError('Error: For modules update operation, data must be an array of module objects. Example: [{name: "Module1", parentModule: null}]');
              }
              for (const m of data) {
                if (!m.name || m.parentModule === undefined) {
                  return handleError('Error: Modules must have "name" and "parentModule" fields');
                }
              }
              model.modules = data;
            } else if (operation === 'add') {
              if (!Array.isArray(data)) {
                return handleError('Error: For modules add operation, data must be an array of module objects. Example: [{name: "Module1", parentModule: null}]');
              }
              for (const m of data) {
                if (!m.name || m.parentModule === undefined) {
                  return handleError('Error: Modules must have "name" and "parentModule" fields');
                }
              }
              model.modules.push(...data);
            } else if (operation === 'remove') {
              if (!Array.isArray(data)) {
                return handleError('Error: For modules remove operation, data must be an array of module name strings. Example: ["Module1", "Module2"]');
              }
              model.modules = model.modules.filter(m => !data.includes(m.name));
            }
            break;
        }

        const mode = session.mode;

        if (mode !== 'sfd') {
          return handleError('Error: Model editing is only supported for quantitative (SFD) models');
        }

        const supportsArrays = session.context?.supportsArrays || false;
        const supportsModules = session.context?.supportsModules || false;

        if (!model.variables || !Array.isArray(model.variables)) {
          return handleError('Model validation failed: model.variables must be an array.');
        }

        if (!model.relationships || !Array.isArray(model.relationships)) {
          return handleError('Model validation failed: model.relationships must be an array.');
        }

        writeFileSync(modelPath, JSON.stringify(model, null, 2));
        logger.log(`Model written to: ${modelPath}`);

        const updateRequestId = generateRequestId('model');
        await sendToClient(createUpdateModelMessage(sessionId, updateRequestId, model));

        const updatePromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Update model timeout: Client did not respond within 30 seconds'));
          }, 30000);

          if (!session.pendingModelRequests) {
            session.pendingModelRequests = new Map();
          }
          session.pendingModelRequests.set(updateRequestId, { resolve, reject, timeout });
        });

        await updatePromise;

        sessionManager.updateClientModel(sessionId, model);

        return createSuccessResponse(`Successfully edited ${section} section (${operation} operation). The model has been validated, processed, and sent to the client.`);
      } catch (error) {
        return handleError(`Failed to edit model section: ${error.message}`, error);
      }
    }
  };
}
