/**
 * Flatten a modular XMILE model into a single root model, so PySD can simulate it.
 *
 * PySD's XMILE reader loads only the root <model> and ignores module sub-models: a variable
 * inside a module is "not found as model element", and a module with a ghost (an input bound
 * by <connect>) fails to load with "list index out of range". Merlin's run_model could not
 * simulate any modular model it built. A module is only a namespace for simulation, so the same
 * model can be written flat: every module variable becomes a root variable named by its module
 * path, every reference to it is rewritten, and every ghost becomes an auxiliary equal to the
 * variable it mirrors.
 */

/** Joins a module path to a local name in a flat variable name; chickens.count -> chickens__count. */
const FLAT_SEPARATOR = '__';

/**
 * The XMILE identity of a name: case-insensitive, with spaces, underscores and line breaks all
 * the same separator. Dots are kept, since they separate module path segments.
 * @param {string} name A variable name in any of its spellings
 * @returns {string} The canonical form of the name
 */
function canonical(name) {
    return String(name).replace(/\\[nr]/g, ' ').replace(/[\s_]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}

/**
 * Decode the XML and XMILE escapes a name attribute can carry.
 * @param {string} attribute The raw attribute value
 * @returns {string} The name
 */
function decodeName(attribute) {
    return attribute
        .replace(/\\[nr]/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/**
 * Write a name as an XMILE equation identifier: bare when it is a plain word, quoted otherwise.
 * @param {string} name The variable name
 * @returns {string} The identifier to put in an equation
 */
function asIdentifier(name) {
    const underscored = name.trim().replace(/\s+/g, '_');
    return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(underscored) ? underscored : `"${name.replace(/"/g, '')}"`;
}

/**
 * Read one attribute of an XML start tag.
 * @param {string} startTag The start tag text
 * @param {string} attribute The attribute name
 * @returns {string|undefined} The raw attribute value
 */
function attributeOf(startTag, attribute) {
    const match = startTag.match(new RegExp(`\\s${attribute}\\s*=\\s*"([^"]*)"`));
    return match ? match[1] : undefined;
}

/**
 * Rewrite every variable reference in an equation. Numbers, XML entities and names that do not
 * resolve (builtins such as DELAY3 or TIME) pass through untouched.
 * @param {string} equation The equation text as it appears inside <eqn>
 * @param {function(string): (string|undefined)} resolve Maps a referenced name to its flat name
 * @returns {string} The equation with references rewritten
 */
function rewriteEquation(equation, resolve) {
    let out = '';
    let i = 0;
    const identifier = /^[\p{L}_][\p{L}\p{N}_$]*(?:\.[\p{L}_][\p{L}\p{N}_$]*)*/u;
    while (i < equation.length) {
        const rest = equation.slice(i);
        const ch = equation[i];
        if (ch === '&') {
            const entity = rest.match(/^&[#\w]+;/);
            const text = entity ? entity[0] : ch;
            out += text;
            i += text.length;
        } else if (ch === '"') {
            const end = equation.indexOf('"', i + 1);
            if (end === -1) {
                out += rest;
                break;
            }
            const name = equation.slice(i + 1, end);
            const flat = resolve(name);
            out += flat ? asIdentifier(flat) : equation.slice(i, end + 1);
            i = end + 1;
        } else if (/[0-9.]/.test(ch) && /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.test(rest)) {
            const number = rest.match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/)[0];
            out += number;
            i += number.length;
        } else if (identifier.test(rest)) {
            const name = rest.match(identifier)[0];
            const flat = resolve(name);
            out += flat ? asIdentifier(flat) : name;
            i += name.length;
        } else {
            out += ch;
            i += 1;
        }
    }
    return out;
}

/**
 * Split a <variables> body into its variable elements and module elements.
 * @param {string} body The inner text of a <variables> element
 * @returns {{variables: Array<{kind: string, startTag: string, xml: string}>, modules: Array<{startTag: string, xml: string}>}}
 */
function readVariables(body) {
    const variables = [];
    const modules = [];
    const element = /<(stock|flow|aux|module)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
    for (const match of body.matchAll(element)) {
        const startTag = `<${match[1]}${match[2]}>`;
        if (match[1] === 'module') {
            modules.push({ startTag, xml: match[0] });
        } else {
            variables.push({ kind: match[1], startTag, xml: match[0] });
        }
    }
    return { variables, modules };
}

/**
 * Flatten the modules of an XMILE model into its root model.
 * @param {string} xmileContent The XMILE model
 * @returns {{xmile: string, aliases: Map<string, string>}} The flat model, and each module
 *   variable's canonical qualified name (chickens.count) mapped to its flat name
 */
export function flattenXmileModules(xmileContent) {
    const aliases = new Map();
    if (!/<module\b/.test(xmileContent)) {
        return { xmile: xmileContent, aliases };
    }

    const models = new Map();
    let root;
    for (const match of xmileContent.matchAll(/<model\b([^>]*)>([\s\S]*?)<\/model>/g)) {
        const name = attributeOf(`<model${match[1]}>`, 'name');
        const body = (match[2].match(/<variables>([\s\S]*?)<\/variables>/) || [])[1] || '';
        if (name === undefined) {
            root = body;
        } else {
            models.set(canonical(decodeName(name)), body);
        }
    }
    if (root === undefined) {
        return { xmile: xmileContent, aliases };
    }

    // Walk the module tree from the root, collecting every variable with its module path and
    // every connection that binds a module input.
    const collected = [];
    const connections = [];
    const walk = (body, path, seen) => {
        const { variables, modules } = readVariables(body);
        for (const variable of variables) {
            const localName = decodeName(attributeOf(variable.startTag, 'name') || '');
            collected.push({ ...variable, path, localName });
        }
        for (const module of modules) {
            const instance = decodeName(attributeOf(module.startTag, 'name') || '');
            const modelName = canonical(decodeName(attributeOf(module.startTag, 'model') || instance));
            // Stella writes each binding as <connect> and as <connect2>; <connect2> is the
            // authoritative form, so it is read when present.
            const tag = /<connect2\b/.test(module.xml) ? 'connect2' : 'connect';
            for (const connect of module.xml.matchAll(new RegExp(`<${tag}\\b([^>]*)\\/?>`, 'g'))) {
                const to = attributeOf(`<${tag}${connect[1]}>`, 'to');
                const from = attributeOf(`<${tag}${connect[1]}>`, 'from');
                if (to !== undefined && from !== undefined) {
                    connections.push({ to: decodeName(to), from: decodeName(from), path, instance });
                }
            }
            if (models.has(modelName) && !seen.has(modelName)) {
                walk(models.get(modelName), [...path, instance], new Set([...seen, modelName]));
            }
        }
    };
    walk(root, [], new Set());

    // Flat name for every variable, reachable by its canonical qualified name.
    const flatByQualified = new Map();
    for (const variable of collected) {
        variable.flatName = [...variable.path, variable.localName].join(FLAT_SEPARATOR);
        variable.qualified = [...variable.path.map(canonical), canonical(variable.localName)].join('.');
        flatByQualified.set(variable.qualified, variable.flatName);
        if (variable.path.length > 0) {
            aliases.set(variable.qualified, variable.flatName);
            // SD-JSON names a variable by its immediate module only (frimbulators.count, even
            // inside root.frimbulators), so that spelling reaches it too.
            const immediate = `${canonical(variable.path[variable.path.length - 1])}.${canonical(variable.localName)}`;
            if (!aliases.has(immediate)) aliases.set(immediate, variable.flatName);
        }
    }

    // A reference resolves in the referring module first, then from the root, so both local
    // names (count) and qualified ones (foxes.count) find their variable.
    const resolverFor = (path) => (name) => {
        const key = canonical(name).replace(/^\./, '');
        for (let depth = path.length; depth >= 0; depth--) {
            const prefix = path.slice(0, depth).map(canonical);
            const flat = flatByQualified.get([...prefix, key].join('.'));
            if (flat) return flat;
        }
        return undefined;
    };

    // A module input takes its value from the variable its connection names.
    const sourceOfInput = (variable) => {
        const qualifiedTo = (connection) => {
            const to = canonical(connection.to).replace(/^\./, '');
            const inInstance = [...connection.path.map(canonical), canonical(connection.instance), to].join('.');
            // "to" is usually qualified relative to the model holding the <module> element
            // (yelbs.illigents_count inside model root), so it is also read from there.
            const inEnclosing = [...connection.path.map(canonical), to].join('.');
            return [to, inInstance, inEnclosing];
        };
        for (const connection of connections) {
            if (qualifiedTo(connection).includes(variable.qualified)) {
                return resolverFor(connection.path)(connection.from);
            }
        }
        return undefined;
    };

    const flatVariables = collected.map((variable) => {
        const resolve = resolverFor(variable.path);
        let xml = variable.xml
            .replace(variable.startTag.slice(0, -1), variable.startTag.slice(0, -1)
                .replace(/\sname\s*=\s*"[^"]*"/, ` name="${variable.flatName.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
                .replace(/\saccess\s*=\s*"[^"]*"/, ''))
            .replace(/<eqn>([\s\S]*?)<\/eqn>/g, (whole, equation) => `<eqn>${rewriteEquation(equation, resolve)}</eqn>`)
            .replace(/<(inflow|outflow)>([^<]*)<\/\1>/g, (whole, tag, name) => `<${tag}>${asIdentifier(resolve(decodeName(name)) || decodeName(name))}</${tag}>`);

        if (/\saccess\s*=\s*"input"/.test(variable.startTag)) {
            const source = sourceOfInput(variable);
            if (source) {
                const equation = `<eqn>${asIdentifier(source)}</eqn>`;
                if (/<eqn>[\s\S]*?<\/eqn>/.test(xml)) {
                    xml = xml.replace(/<eqn>[\s\S]*?<\/eqn>/, equation);
                } else if (xml.endsWith('/>')) {
                    xml = `${xml.slice(0, -2)}>${equation}</${variable.kind}>`;
                } else {
                    xml = xml.replace(new RegExp(`</${variable.kind}>$`), `${equation}</${variable.kind}>`);
                }
            }
        }
        return `      ${xml}`;
    });

    const flatModel = `<model>\n    <variables>\n${flatVariables.join('\n')}\n    </variables>\n  </model>`;
    let placed = false;
    const xmile = xmileContent.replace(/[ \t]*<model\b[^>]*>[\s\S]*?<\/model>\s*/g, () => {
        if (placed) return '';
        placed = true;
        return `  ${flatModel}\n`;
    });
    return { xmile, aliases };
}
