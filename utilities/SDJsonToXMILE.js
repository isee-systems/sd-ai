/**
 * SD-JSON to XMILE Converter
 * Converts SD-JSON format models to XMILE v1.0 XML format
 * Based on OASIS XMILE v1.0 specification: https://docs.oasis-open.org/xmile/xmile/v1.0/xmile-v1.0.html
 */

import utils from './utils.js';

/**
 * Converts safe division operator (//) to regular division (/) in all equations
 * Modifies the model in place
 * @param {Object} model - The SD-JSON model
 */
function convertSafeDivisionInModel(model) {
    if (!model.variables || !Array.isArray(model.variables)) {
        return;
    }

    model.variables.forEach(variable => {
        // Convert main equation field
        if (variable.equation && typeof variable.equation === 'string' && variable.equation.includes('//')) {
            variable.equation = variable.equation.replace(/\/\//g, '/');
        }

        // Convert arrayEquations if present
        if (variable.arrayEquations && Array.isArray(variable.arrayEquations)) {
            variable.arrayEquations.forEach(eq => {
                if (eq.equation && typeof eq.equation === 'string' && eq.equation.includes('//')) {
                    eq.equation = eq.equation.replace(/\/\//g, '/');
                }
            });
        }
    });
}

/**
 * Converts an SD-JSON model to XMILE XML format
 * @param {Object} sdJson - The SD-JSON model object (can include the 'model' wrapper or be the model directly)
 * @param {Object} options - Optional configuration
 * @param {string} options.modelName - Name of the model (optional)
 * @param {string} options.vendor - Vendor name (default: "BEAMS Initiative")
 * @param {string} options.product - Product name (default: "sd-ai")
 * @param {string} options.version - Product version (default: "1.0")
 * @param {boolean} options.convertSafeDivision - Convert // (safe division) to / (default: true)
 * @returns {string} XMILE XML string
 */
function SDJsonToXMILE(sdJson, options = {}) {
    // Handle case where sdJson has a 'model' property (like in eval files)
    const input = sdJson.model || sdJson;
    // Modules given as bare names (['herd']) rather than {name, parentModule} objects are
    // read as top-level modules. Read as objects they had no name, and every module variable
    // vanished from the XMILE.
    const model = Array.isArray(input.modules)
        ? { ...input, modules: input.modules.map((m) => typeof m === 'string' ? { name: m, parentModule: '' } : { ...m, parentModule: m.parentModule || '' }) }
        : input;

    // Validate input
    if (!model.variables || !Array.isArray(model.variables)) {
        throw new Error('Invalid SD-JSON: missing or invalid variables array');
    }
    if (!model.relationships || !Array.isArray(model.relationships)) {
        throw new Error('Invalid SD-JSON: missing or invalid relationships array');
    }

    const {
        modelName = 'SD Model',
        vendor = 'BEAMS Initiative',
        product = 'sd-ai',
        version = '1.0',
        convertSafeDivision = true
    } = options;

    // Convert safe division operator if enabled
    if (convertSafeDivision) {
        convertSafeDivisionInModel(model);
    }

    // Build XMILE document
    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0">');

    // Header
    lines.push('  <header>');
    lines.push(`    <vendor>${escapeXml(vendor)}</vendor>`);
    lines.push(`    <product version="${escapeXml(version)}">${escapeXml(product)}</product>`);
    lines.push('    <name>' + escapeXml(modelName) + '</name>');
    lines.push('  </header>');

    // Simulation specs
    if (model.specs) {
        lines.push(...buildSimSpecs(model.specs));
    }

    // Model units
    const modelUnits = extractModelUnits(model.variables);
    if (modelUnits.length > 0) {
        lines.push('  <model_units>');
        modelUnits.forEach(unit => {
            lines.push(`    <unit name="${escapeXml(unit)}">`);
            lines.push(`      <eqn>${escapeXml(unit)}</eqn>`);
            lines.push('    </unit>');
        });
        lines.push('  </model_units>');
    }

    // Dimensions (array dimensions)
    if (model.specs?.arrayDimensions && model.specs.arrayDimensions.length > 0) {
        lines.push('  <dimensions>');
        model.specs.arrayDimensions.forEach(dim => {
            lines.push(...buildDimension(dim));
        });
        lines.push('  </dimensions>');
    }

    // Model - handle modules if present
    if (model.modules && model.modules.length > 0) {
        // Group variables by module
        const variablesByModule = groupVariablesByModule(model);

        // Find all ghost variable connections
        const ghostConnections = findGhostConnections(model);

        // Build module hierarchy
        const moduleTree = buildModuleTree(model.modules);

        // Build top-level model
        lines.push('  <model>');
        lines.push(...buildModuleLevel(moduleTree, '', variablesByModule, ghostConnections, model, '    '));
        lines.push('  </model>');

        // Build all module definitions at the same level (siblings, not nested)
        lines.push(...buildAllModuleDefinitions(moduleTree, variablesByModule, ghostConnections, model));
    } else {
        // No modules - simple flat structure
        lines.push('  <model>');
        lines.push('    <variables>');

        // Separate variables by type
        const stocks = model.variables.filter(v => v.type === 'stock');
        const flows = model.variables.filter(v => v.type === 'flow');
        const auxiliaries = model.variables.filter(v => v.type === 'variable');

        // Add stocks
        stocks.forEach(stock => {
            lines.push(...buildStock(stock, model));
        });

        // Add flows
        flows.forEach(flow => {
            lines.push(...buildFlow(flow, model));
        });

        // Add auxiliaries
        auxiliaries.forEach(aux => {
            lines.push(...buildAuxiliary(aux, model));
        });

        lines.push('    </variables>');
        lines.push('  </model>');
    }
    lines.push('</xmile>');

    return lines.join('\n');
}

/**
 * The identity of a variable name for matching references: case-insensitive, with spaces,
 * underscores and line breaks all the same separator.
 * @param {string} name A name in any of its spellings
 * @returns {string} The matching key
 */
function referenceKey(name) {
    return String(name).replace(/\\[nr]/g, ' ').replace(/[\s_]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}

/**
 * Write a local name as an XMILE equation identifier, quoting it when it is not a plain word.
 * @param {string} name The local variable name
 * @returns {string} The identifier
 */
function equationIdentifier(name) {
    const identifier = utils.xmileName(name.trim());
    return /^[\p{L}_][\p{L}\p{N}_$]*$/u.test(identifier) ? identifier : `"${identifier.replace(/"/g, '')}"`;
}

const referenceIndexes = new WeakMap();

/**
 * Index the model's variables for resolving equation references, once per model.
 * @param {Object} model The SD-JSON model
 * @returns {{byModuleLocal: Map, byJoined: Map, ghostBySource: Map}} The index
 */
function referenceIndex(model) {
    if (referenceIndexes.has(model)) return referenceIndexes.get(model);
    const byModuleLocal = new Map();
    const byJoined = new Map();
    const ghostBySource = new Map();
    for (const variable of model.variables) {
        if (typeof variable.name !== 'string') continue;
        const dot = variable.name.indexOf('.');
        const module = dot === -1 ? '' : variable.name.slice(0, dot);
        const local = dot === -1 ? variable.name : variable.name.slice(dot + 1);
        const entry = { variable, module, local };
        byModuleLocal.set(`${referenceKey(module)}|${referenceKey(local)}`, entry);
        if (module) byJoined.set(referenceKey(`${module}_${local}`), entry);
        if (variable.crossLevelGhostOf) {
            ghostBySource.set(`${referenceKey(module)}|${referenceKey(variable.crossLevelGhostOf)}`, entry);
        }
    }
    const index = { byModuleLocal, byJoined, ghostBySource };
    referenceIndexes.set(model, index);
    return index;
}

/**
 * Resolve one reference in an equation to the XMILE identifier it means in the module the
 * equation belongs to.
 *
 * SD-JSON names module variables "module.local name", and engines write references in more
 * than one way: the local name (hare_density), the full name with spaces (lions.birth rate),
 * or the module joined by an underscore (marticatenes_enhancement_rate). XMILE only knows the
 * local identifier inside a module, so every spelling is resolved to it. A reference to
 * another module's variable goes through the ghost that mirrors it when there is one, and is
 * otherwise written module-qualified. A variable never resolves to itself, since an equation
 * that names its own variable means a same-named variable elsewhere.
 * @param {string} text The reference as written
 * @param {Object} variable The variable whose equation this is
 * @param {string} currentModule The immediate module the variable is in ('' at top level)
 * @param {Object} model The SD-JSON model
 * @returns {string|undefined} The identifier, or undefined when the text names no variable
 */
function resolveReference(text, variable, currentModule, model) {
    const { byModuleLocal, byJoined, ghostBySource } = referenceIndex(model);
    const here = referenceKey(currentModule);
    const key = referenceKey(text);

    const local = byModuleLocal.get(`${here}|${key}`);
    if (local && local.variable !== variable) return equationIdentifier(local.local);

    const writeTarget = (target) => {
        if (!target || target.variable === variable) return undefined;
        if (referenceKey(target.module) === here) return equationIdentifier(target.local);
        const ghost = ghostBySource.get(`${here}|${referenceKey(target.variable.name)}`);
        if (ghost) return equationIdentifier(ghost.local);
        if (!target.module) return equationIdentifier(target.local);
        return `${equationIdentifier(target.module)}.${equationIdentifier(target.local)}`;
    };

    const dot = text.indexOf('.');
    if (dot !== -1) {
        const qualified = writeTarget(byModuleLocal.get(`${referenceKey(text.slice(0, dot))}|${referenceKey(text.slice(dot + 1))}`));
        if (qualified) return qualified;
    }
    return writeTarget(byJoined.get(key)) ?? writeTarget(byModuleLocal.get(`|${key}`));
}

/**
 * Rewrite every variable reference in an equation into XMILE identifiers for its module.
 * Names may contain spaces, so each run of words is matched longest first against the model's
 * variables; words that name no variable (builtins, keywords) pass through unchanged, as do
 * numbers and operators.
 * @param {string} equation The SD-JSON equation
 * @param {Object} variable The variable whose equation this is
 * @param {string} currentModule The immediate module of the variable ('' at top level)
 * @param {Object} model The SD-JSON model
 * @returns {string} The XMILE equation
 */
function translateEquation(equation, variable, currentModule, model) {
    if (typeof equation !== 'string' || equation === '') return equation;
    const word = /^[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*/u;
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
    let out = '';
    let i = 0;
    while (i < equation.length) {
        const rest = equation.slice(i);
        if (rest[0] === '"') {
            const end = equation.indexOf('"', i + 1);
            if (end === -1) { out += rest; break; }
            const resolved = resolveReference(equation.slice(i + 1, end), variable, currentModule, model);
            out += resolved ?? equation.slice(i, end + 1);
            i = end + 1;
        } else if (number.test(rest) && !/[\p{L}_$]/u.test(equation[i - 1] || '')) {
            const match = rest.match(number)[0];
            out += match;
            i += match.length;
        } else if (word.test(rest)) {
            // Gather the run of words separated by single spaces, then take the longest
            // prefix of it that names a variable.
            const words = [];
            let j = i;
            while (words.length < 8) {
                const found = equation.slice(j).match(word);
                if (!found) break;
                words.push({ text: found[0], end: j + found[0].length });
                const gap = equation.slice(words[words.length - 1].end).match(/^[ \t]+/);
                if (!gap) break;
                j = words[words.length - 1].end + gap[0].length;
            }
            let consumed = false;
            for (let n = words.length; n >= 1; n--) {
                const text = equation.slice(i, words[n - 1].end);
                const resolved = resolveReference(text, variable, currentModule, model);
                if (resolved) {
                    out += resolved;
                    i = words[n - 1].end;
                    consumed = true;
                    break;
                }
            }
            if (!consumed) {
                out += words[0].text;
                i = words[0].end;
            }
        } else {
            out += rest[0];
            i += 1;
        }
    }
    return out;
}

/**
 * Build simulation specifications
 */
function buildSimSpecs(specs) {
    const lines = [];
    lines.push(specs.integrationMethod
        ? `  <sim_specs method="${escapeXml(specs.integrationMethod)}">`
        : '  <sim_specs>');
    lines.push(`    <start>${specs.startTime !== undefined ? specs.startTime : 0}</start>`);
    lines.push(`    <stop>${specs.stopTime !== undefined ? specs.stopTime : 100}</stop>`);
    lines.push(`    <dt>${specs.dt !== undefined ? specs.dt : 1}</dt>`);

    if (specs.timeUnits) {
        lines.push(`    <time_units>${escapeXml(specs.timeUnits)}</time_units>`);
    }

    lines.push('  </sim_specs>');
    return lines;
}

/**
 * Group variables by their module (handles hierarchical modules)
 * @param {Object} model - The SD-JSON model
 * @returns {Object} Variables grouped by full module path (empty string for top-level)
 */
function groupVariablesByModule(model) {
    const grouped = {};

    model.variables.forEach(variable => {
        // Extract full module path from variable name
        // For "Parent.Child.variable" -> "Parent.Child"
        // For "Module.variable" -> "Module"
        const modulePath = getModulePath(variable.name, model);

        if (!grouped[modulePath]) {
            grouped[modulePath] = [];
        }
        grouped[modulePath].push(variable);
    });

    return grouped;
}

/**
 * Extract the full module path from a variable name
 * Variable names are always qualified by only their immediate containing module.
 * For example: "B.x" where B is in module A has full path "A.B"
 *
 * @param {string} varName - Variable name (e.g., "B.x" where B is the immediate module)
 * @param {Object} model - The SD-JSON model (used to check module definitions)
 * @returns {string} Full module path (e.g., "A.B") or empty string for top-level
 */
function getModulePath(varName, model) {
    const parts = varName.split('.');

    // If no dots, it's a top-level variable
    if (parts.length === 1) {
        return '';
    }

    // Variable names use only immediate module name (first part before dot)
    // We need to find the full path of this module
    const immediateModuleName = parts[0];

    if (model.modules && model.modules.length > 0) {
        // Find the module with this simple name and return its full path
        const moduleInfo = model.modules.find(m => utils.sameVars(m.name, immediateModuleName));
        if (moduleInfo) {
            return moduleInfo.parentModule ? `${moduleInfo.parentModule}.${moduleInfo.name}` : moduleInfo.name;
        }
    }

    // Default: return the simple module name
    return immediateModuleName;
}

/**
 * Find all ghost variable connections (crossLevelGhostOf relationships)
 * @param {Object} model - The SD-JSON model
 * @returns {Array} Array of connection objects with source, target, sourceModule, targetModule
 */
function findGhostConnections(model) {
    const connections = [];

    model.variables.forEach(variable => {
        if (variable.crossLevelGhostOf) {
            // Extract module names using getModulePath
            const targetModule = getModulePath(variable.name, model);
            const sourceModule = getModulePath(variable.crossLevelGhostOf, model);

            connections.push({
                target: variable.name,
                source: variable.crossLevelGhostOf,
                targetModule,
                sourceModule
            });
        }
    });

    return connections;
}

/**
 * Build a tree structure of modules organized by parent-child relationships
 * @param {Array} modules - Array of module definitions
 * @returns {Object} Tree structure with children arrays
 */
function buildModuleTree(modules) {
    const tree = {
        name: '',
        fullPath: '',
        children: []
    };

    const moduleMap = new Map();
    moduleMap.set('', tree);

    // Create all nodes
    modules.forEach(mod => {
        const fullPath = mod.parentModule ? `${mod.parentModule}.${mod.name}` : mod.name;
        const node = {
            name: mod.name,
            fullPath: fullPath,
            parentModule: mod.parentModule,
            children: []
        };
        moduleMap.set(fullPath, node);
    });

    // Build tree structure
    modules.forEach(mod => {
        const fullPath = mod.parentModule ? `${mod.parentModule}.${mod.name}` : mod.name;
        const node = moduleMap.get(fullPath);
        const parent = moduleMap.get(mod.parentModule || '');
        if (parent && node) {
            parent.children.push(node);
        }
    });

    return tree;
}

/**
 * Build a module level's variables section (no nested model definitions)
 * @param {Object} moduleNode - Current module tree node
 * @param {string} currentPath - Full path of current module
 * @param {Object} variablesByModule - Variables grouped by module
 * @param {Array} ghostConnections - Ghost variable connections
 * @param {Object} model - The SD-JSON model
 * @param {string} indent - Current indentation string
 * @returns {Array} Lines of XMILE
 */
function buildModuleLevel(moduleNode, currentPath, variablesByModule, ghostConnections, model, indent) {
    const lines = [];

    // Add variables section
    lines.push(`${indent}<variables>`);

    // Add variables for this level
    const vars = variablesByModule[currentPath] || [];
    vars.forEach(variable => {
        lines.push(...buildVariable(variable, model, currentPath).map(line => '  ' + line));
    });

    // Add module placeholders for child modules
    moduleNode.children.forEach(childModule => {
        lines.push(`${indent}  <module name="${escapeNameAttribute(childModule.name)}">`);

        // Add connect tags for this module's ghost variables. Stella lists each binding on
        // both modules it joins, with both ends module-qualified in XMILE identifier form
        // (to="Housing.Population" from="Population.Population"). These were written with
        // raw SD-JSON names ("chickens.foxes count"), which name nothing in the XMILE.
        const moduleConnections = ghostConnections.filter(conn =>
            conn.targetModule === childModule.fullPath || conn.sourceModule === childModule.fullPath
        );

        const qualifiedIdentifier = (name, modulePath) => {
            const module = modulePath.split('.').pop();
            const local = utils.xmileName(getLocalName(name, modulePath));
            return module ? `${utils.xmileName(module)}.${local}` : local;
        };
        moduleConnections.forEach(conn => {
            const to = qualifiedIdentifier(conn.target, conn.targetModule);
            const from = qualifiedIdentifier(conn.source, conn.sourceModule);
            // Stella writes each binding as <connect> and again as <connect2>; <connect2> is
            // the authoritative one, and <connect> is kept for older readers.
            lines.push(`${indent}    <connect to="${escapeXml(to)}" from="${escapeXml(from)}"/>`);
            lines.push(`${indent}    <connect2 to="${escapeXml(to)}" from="${escapeXml(from)}"/>`);
        });

        lines.push(`${indent}  </module>`);
    });

    lines.push(`${indent}</variables>`);

    return lines;
}

/**
 * Build all module definitions at the same level (not nested)
 * @param {Object} moduleTree - Root module tree node
 * @param {Object} variablesByModule - Variables grouped by module
 * @param {Array} ghostConnections - Ghost variable connections
 * @param {Object} model - The SD-JSON model
 * @returns {Array} Lines of XMILE
 */
function buildAllModuleDefinitions(moduleTree, variablesByModule, ghostConnections, model) {
    const lines = [];
    const allModules = [];

    // Collect all modules in a flat list
    function collectModules(node) {
        node.children.forEach(child => {
            allModules.push(child);
            collectModules(child);
        });
    }
    collectModules(moduleTree);

    // Build each module definition at the same level
    allModules.forEach(moduleNode => {
        const moduleVars = variablesByModule[moduleNode.fullPath] || [];

        if (moduleVars.length > 0 || moduleNode.children.length > 0) {
            lines.push(`  <model name="${escapeNameAttribute(moduleNode.name)}">`);
            lines.push(...buildModuleLevel(moduleNode, moduleNode.fullPath, variablesByModule, ghostConnections, model, '    '));
            lines.push('  </model>');
        }
    });

    return lines;
}

/**
 * Build a variable (stock, flow, or aux) with appropriate type
 * @param {Object} variable - The variable object
 * @param {Object} model - The SD-JSON model
 * @param {string} currentModule - The current module name (for stripping prefix)
 * @returns {Array} Lines of XMILE
 */
function buildVariable(variable, model, currentModule = '') {
    if (variable.type === 'stock') {
        return buildStock(variable, model, currentModule);
    } else if (variable.type === 'flow') {
        return buildFlow(variable, model, currentModule);
    } else {
        return buildAuxiliary(variable, model, currentModule);
    }
}

/**
 * Get the local name of a variable (strip module prefix if in module)
 * @param {string} fullName - Full variable name (may include module prefix)
 * @param {string} currentModule - Current module full path (e.g., "A.B")
 * @returns {string} Local name
 */
function getLocalName(fullName, currentModule) {
    return untrimmedLocalName(fullName, currentModule).trim();
}

/**
 * The local name before trimming. Kept separate so the surrounding whitespace an engine leaves
 * in a name ("associates. rookies promotions") is dropped in one place: XMILE ignores it, but
 * utils.xmileName turned it into a leading underscore, so a ghost's name and its connect
 * disagreed and the ghost never received its value.
 */
function untrimmedLocalName(fullName, currentModule) {
    if (!currentModule) {
        return fullName;
    }

    // Module names match as XMILE names do, ignoring case and space/underscore spelling: a
    // model declaring module "lions" names its variables "Lions.count". A case-sensitive
    // match kept the prefix, so the variable came out named "Lions.count" inside its own
    // module and nothing could reference it.
    const parts = fullName.split('.');
    const pathParts = currentModule.split('.');

    // Try full module path first (e.g., "A.B.x" -> "x" when currentModule is "A.B")
    if (parts.length > pathParts.length && pathParts.every((p, i) => referenceKey(p) === referenceKey(parts[i]))) {
        return parts.slice(pathParts.length).join('.');
    }

    // Try simple module name (e.g., "B.x" -> "x" when currentModule is "A.B")
    if (parts.length > 1 && referenceKey(parts[0]) === referenceKey(pathParts[pathParts.length - 1])) {
        return parts.slice(1).join('.');
    }

    return fullName;
}

/**
 * Build dimension definition for arrays
 */
function buildDimension(dim) {
    const lines = [];
    if (dim.type === 'numeric') {
        lines.push(`    <dim name="${escapeXml(dim.name)}" size="${dim.size}"/>`);
    } else {
        // labels type
        lines.push(`    <dim name="${escapeXml(dim.name)}">`);
        if (dim.elements && Array.isArray(dim.elements)) {
            dim.elements.forEach(elem => {
                lines.push(`      <elem name="${escapeXml(elem)}"/>`);
            });
        }
        lines.push('    </dim>');
    }
    return lines;
}

/**
 * Determine access attribute for a variable (for module inputs/outputs)
 * @param {Object} variable - The variable object
 * @param {Object} model - The SD-JSON model
 * @returns {string} Access attribute string (e.g., ' access="input"' or '')
 */
function getAccessAttribute(variable, model) {
    // Check if this is a ghost variable (input from another module)
    if (variable.crossLevelGhostOf) {
        return ' access="input"';
    }

    // Check if this variable is referenced as a ghost source (output to another module)
    const isGhostSource = model.variables.some(v => v.crossLevelGhostOf && utils.sameVars(v.crossLevelGhostOf, variable.name));
    if (isGhostSource) {
        return ' access="output"';
    }

    return '';
}

/**
 * Build stock variable
 */
function buildStock(stock, model, currentModule = '') {
    const lines = [];
    const localName = getLocalName(stock.name, currentModule);
    const xmileName = utils.xmileName(localName);

    // Get access attribute (for module inputs/outputs)
    const accessAttr = getAccessAttribute(stock, model);

    // All stocks can go negative (no non-negative constraint)
    lines.push(`      <stock name="${escapeNameAttribute(xmileName)}"${accessAttr}>`);

    // Documentation
    if (stock.documentation) {
        lines.push(`        <doc>${escapeXml(stock.documentation)}</doc>`);
    }

    // Equation (initial value) - ghost variables have no equation
    if (stock.equation && !stock.crossLevelGhostOf) {
        lines.push(`        <eqn>${escapeXml(translateEquation(stock.equation, stock, currentModule.split('.').pop(), model))}</eqn>`);
    }

    // Inflows
    if (stock.inflows && Array.isArray(stock.inflows)) {
        stock.inflows.forEach(inflow => {
            const localInflow = getLocalName(inflow, currentModule);
            lines.push(`        <inflow>${escapeNameAttribute(utils.xmileName(localInflow))}</inflow>`);
        });
    }

    // Outflows
    if (stock.outflows && Array.isArray(stock.outflows)) {
        stock.outflows.forEach(outflow => {
            const localOutflow = getLocalName(outflow, currentModule);
            lines.push(`        <outflow>${escapeNameAttribute(utils.xmileName(localOutflow))}</outflow>`);
        });
    }

    // Units
    if (stock.units) {
        lines.push(`        <units>${escapeXml(stock.units)}</units>`);
    }

    // Dimensions (for arrayed variables)
    if (stock.dimensions && Array.isArray(stock.dimensions) && stock.dimensions.length > 0) {
        const dimStr = stock.dimensions.map(d => escapeXml(d)).join(', ');
        lines.push(`        <dimensions>${dimStr}</dimensions>`);
    }

    lines.push('      </stock>');
    return lines;
}

/**
 * Build flow variable
 */
function buildFlow(flow, model, currentModule = '') {
    const lines = [];
    const localName = getLocalName(flow.name, currentModule);
    const xmileName = utils.xmileName(localName);

    // Get access attribute (for module inputs/outputs)
    const accessAttr = getAccessAttribute(flow, model);

    // Only constrain to non-negative when uniflow is explicitly true
    const nonNegative = !!flow.uniflow;

    lines.push(`      <flow name="${escapeNameAttribute(xmileName)}"${accessAttr}>`);

    // Documentation
    if (flow.documentation) {
        lines.push(`        <doc>${escapeXml(flow.documentation)}</doc>`);
    }

    // Non-negative tag (empty child element)
    if (nonNegative) {
        lines.push('        <non_negative/>');
    }

    // Ghost variables have no equation - connections are handled via <connect> tags
    if (!flow.crossLevelGhostOf) {
        // Equation - generate NAN equation if missing
        let equation = translateEquation(flow.equation, flow, currentModule.split('.').pop(), model);
        if (!equation) {
            equation = generateNanEquation(flow.name, model);
        }
        if (equation) {
            lines.push(`        <eqn>${escapeXml(equation)}</eqn>`);
        }
    }

    // Units
    if (flow.units) {
        lines.push(`        <units>${escapeXml(flow.units)}</units>`);
    }

    // Dimensions (for arrayed variables)
    if (flow.dimensions && Array.isArray(flow.dimensions) && flow.dimensions.length > 0) {
        const dimStr = flow.dimensions.map(d => escapeXml(d)).join(', ');
        lines.push(`        <dimensions>${dimStr}</dimensions>`);
    }

    lines.push('      </flow>');
    return lines;
}

/**
 * Build auxiliary variable
 */
function buildAuxiliary(aux, model, currentModule = '') {
    const lines = [];
    const localName = getLocalName(aux.name, currentModule);
    const xmileName = utils.xmileName(localName);

    // Get access attribute (for module inputs/outputs)
    const accessAttr = getAccessAttribute(aux, model);

    lines.push(`      <aux name="${escapeNameAttribute(xmileName)}"${accessAttr}>`);

    // Documentation
    if (aux.documentation) {
        lines.push(`        <doc>${escapeXml(aux.documentation)}</doc>`);
    }

    // Ghost variables do NOT have equations - connections are handled via <connect> tags
    if (!aux.crossLevelGhostOf) {
        // Get equation - either existing or generate NAN equation from relationships
        let equation = translateEquation(aux.equation, aux, currentModule.split('.').pop(), model);
        if (!equation) {
            equation = generateNanEquation(aux.name, model);
        }

        // Check if this is a delay auxiliary (no equation or starts with NAN()
        const isDelayAux = !equation ||
                           (typeof equation === 'string' && equation.trim().toUpperCase().startsWith('NAN('));

        // Delay aux tag (empty child element)
        if (isDelayAux) {
            lines.push('        <isee:delay_aux/>');
        }

        // Handle graphical functions. An empty points array ([]) is truthy, so we must
        // check length explicitly — engines emit a default graphicalFunction:{points:[]}
        // on plain variables, and without the length check that empty object would be
        // treated as a real lookup, suppressing the numeric <eqn> and producing an
        // equation-less <aux> that fails to load in the simulator.
        const gfPoints = graphicalFunctionPoints(aux.graphicalFunction);
        if (gfPoints.length > 0) {
            lines.push(...buildGraphicalFunction({ points: gfPoints }, equation));
        } else if (equation) {
            // Regular equation
            lines.push(`        <eqn>${escapeXml(equation)}</eqn>`);
        }
    }

    // Units
    if (aux.units) {
        lines.push(`        <units>${escapeXml(aux.units)}</units>`);
    }

    // Dimensions (for arrayed variables)
    if (aux.dimensions && Array.isArray(aux.dimensions) && aux.dimensions.length > 0) {
        const dimStr = aux.dimensions.map(d => escapeXml(d)).join(', ');
        lines.push(`        <dimensions>${dimStr}</dimensions>`);
    }

    lines.push('      </aux>');
    return lines;
}

/**
 * Generate a NAN equation from relationships for variables without equations
 * @param {string} varName - The variable name
 * @param {Object} model - The SD-JSON model
 * @returns {string} NAN equation or empty string
 */
function generateNanEquation(varName, model) {
    if (!model.relationships || !Array.isArray(model.relationships)) {
        return '';
    }

    // Find all relationships where this variable is the "to" (dependent variable)
    const causes = model.relationships
        .filter(rel => utils.sameVars(rel.to, varName))
        .map(rel => utils.xmileName(rel.from));

    if (causes.length === 0) {
        return '';
    }

    // Generate NAN equation with all causes
    return `NAN(${causes.join(',')})`;
}

/**
 * The points of a graphical function. SD-JSON writes { points: [...] }, but older model files
 * (the modular-modification eval inputs among them) write the bare array, and engines handed
 * such a model carry it through. Reading only the object form dropped those lookups silently:
 * the variable was simulated as its raw input, and Merlin's predator-prey runs diverged to
 * -Infinity within one time unit.
 * @param {Object|Array|undefined} graphicalFunction The variable's graphicalFunction field
 * @returns {Array<{x: number, y: number}>} Its points, or an empty array
 */
function graphicalFunctionPoints(graphicalFunction) {
    const points = Array.isArray(graphicalFunction) ? graphicalFunction
        : (graphicalFunction && Array.isArray(graphicalFunction.points)) ? graphicalFunction.points
        : [];
    // A lookup needs at least two points to be a curve. Engines leave single-point
    // placeholders ({points: [{x: 0, y: 0}]}) on plain variables just as they leave empty
    // ones; read as a lookup, one overrode "count = 150" with 0 and failed to load in PySD.
    return points.length >= 2 ? points : [];
}

/**
 * Build graphical function
 */
function buildGraphicalFunction(gf, inputVar) {
    const lines = [];

    if (!gf.points || gf.points.length === 0) {
        return lines;
    }

    // Extract x and y values
    const xpts = gf.points.map(p => p.x);
    const ypts = gf.points.map(p => p.y);

    // Use discrete x-y pairs format (Method 2 from XMILE spec)
    lines.push('        <gf>');
    lines.push(`          <xscale min="${Math.min(...xpts)}" max="${Math.max(...xpts)}"/>`);
    lines.push(`          <yscale min="${Math.min(...ypts)}" max="${Math.max(...ypts)}"/>`);
    lines.push(`          <xpts>${xpts.join(',')}</xpts>`);
    lines.push(`          <ypts>${ypts.join(',')}</ypts>`);
    lines.push('        </gf>');

    // The input variable reference (e.g., "hare_density")
    if (inputVar) {
        lines.push(`        <eqn>${escapeXml(inputVar)}</eqn>`);
    }

    return lines;
}

/**
 * Extract unique units from all variables
 */
function extractModelUnits(variables) {
    const units = new Set();

    variables.forEach(variable => {
        if (variable.units && variable.units.trim() !== '') {
            units.add(variable.units);
        }
    });

    return Array.from(units).sort();
}

/**
 * Escape XML special characters
 */
function escapeXml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';

    return unsafe.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Escape name attributes (includes \n and \r encoding)
 */
function escapeNameAttribute(name) {
    if (!name) return '';

    return escapeXml(name)
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

export default SDJsonToXMILE;
