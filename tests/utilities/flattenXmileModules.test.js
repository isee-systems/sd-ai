import { flattenXmileModules } from '../../evals/utilities/simulator/flattenXmileModules.js';
import SDJsonToXMILE from '../../utilities/SDJsonToXMILE.js';

// PySD loads only the root <model>, so a modular model is flattened before it is simulated.
const toXmile = (variables, modules) => SDJsonToXMILE({
    model: {
        variables,
        modules,
        relationships: [],
        specs: { startTime: 0, stopTime: 2, dt: 1, timeUnits: 'years' }
    }
}, { modelName: 'flatten test', vendor: 'SD-AI Evaluation', product: 'sd-ai-evals', version: '1.0' });

const equationOf = (xmile, name) => {
    const element = xmile.match(new RegExp(`<(?:stock|flow|aux) name="${name}"[^>]*>([\\s\\S]*?)</(?:stock|flow|aux)>`));
    return element ? (element[1].match(/<eqn>([\s\S]*?)<\/eqn>/) || [])[1] : undefined;
};

describe('flattenXmileModules', () => {
    const predatorPrey = toXmile([
        { name: 'foxes.count', type: 'stock', equation: '5' },
        { name: 'chickens.count', type: 'stock', equation: '10', outflows: ['chickens.deaths'] },
        { name: 'chickens.deaths', type: 'flow', equation: 'count*foxes_count*0.01' },
        { name: 'chickens.foxes count', type: 'variable', equation: '', crossLevelGhostOf: 'foxes.count' },
        { name: 'total', type: 'variable', equation: 'foxes.count + chickens.count' }
    ], [{ name: 'foxes', parentModule: '' }, { name: 'chickens', parentModule: '' }]);

    test('leaves a model without modules untouched', () => {
        const xmile = toXmile([{ name: 'stock a', type: 'stock', equation: '1' }], []);
        const { xmile: flat, aliases } = flattenXmileModules(xmile);
        expect(flat).toBe(xmile);
        expect(aliases.size).toBe(0);
    });

    test('puts every variable in one root model with no modules', () => {
        const { xmile } = flattenXmileModules(predatorPrey);
        expect(xmile.match(/<model\b/g)).toHaveLength(1);
        expect(xmile).not.toMatch(/<module\b/);
        expect(xmile).toMatch(/name="foxes__count"/);
        expect(xmile).toMatch(/name="chickens__count"/);
    });

    test('rewrites local references, qualified references and stock flows', () => {
        const { xmile } = flattenXmileModules(predatorPrey);
        expect(equationOf(xmile, 'chickens__deaths')).toBe('chickens__count*chickens__foxes_count*0.01');
        expect(equationOf(xmile, 'total')).toBe('foxes__count + chickens__count');
        expect(xmile).toMatch(/<outflow>chickens__deaths<\/outflow>/);
    });

    test('turns a ghost into an auxiliary equal to its source', () => {
        const { xmile } = flattenXmileModules(predatorPrey);
        expect(equationOf(xmile, 'chickens__foxes_count')).toBe('foxes__count');
        expect(xmile).not.toMatch(/access="input"/);
    });

    test('maps each qualified name to its flat name', () => {
        const { aliases } = flattenXmileModules(predatorPrey);
        expect(aliases.get('chickens.count')).toBe('chickens__count');
        expect(aliases.get('chickens.foxes_count')).toBe('chickens__foxes_count');
    });

    test('binds ghosts in nested modules through the connect of their enclosing model', () => {
        const xmile = toXmile([
            { name: 'source.count', type: 'stock', equation: '7' },
            { name: 'sink.source count', type: 'variable', equation: '', crossLevelGhostOf: 'source.count' }
        ], [{ name: 'root', parentModule: '' }, { name: 'source', parentModule: 'root' }, { name: 'sink', parentModule: 'root' }]);
        const { xmile: flat, aliases } = flattenXmileModules(xmile);
        expect(equationOf(flat, 'root__sink__source_count')).toBe('root__source__count');
        expect(aliases.get('sink.source_count')).toBe('root__sink__source_count');
    });

    test('does not touch numbers, builtins or XML entities in equations', () => {
        const xmile = toXmile([
            { name: 'a.level', type: 'stock', equation: '1E3', inflows: ['a.fill'] },
            { name: 'a.fill', type: 'flow', equation: 'IF level < 2.5e2 THEN DELAY3(level, 3) ELSE 0' }
        ], [{ name: 'a', parentModule: '' }]);
        const { xmile: flat } = flattenXmileModules(xmile);
        expect(equationOf(flat, 'a__level')).toBe('1E3');
        expect(equationOf(flat, 'a__fill')).toBe('IF a__level &lt; 2.5e2 THEN DELAY3(a__level, 3) ELSE 0');
    });
});
