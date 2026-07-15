import { useParams, Link } from 'react-router-dom';
import enginesData from '../generated/engines.json';

const MODE_LABELS = {
  cld: 'Causal Loop Diagram',
  sfd: 'Stock & Flow Diagram',
  'cld-discuss': 'CLD Discussion',
  'sfd-discuss': 'SFD Discussion',
  'ltm-discuss': 'Loops That Matter Narrative',
  documentation: 'Variable Documentation',
};

function ParameterRow({ param }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-center flex-wrap gap-2 mb-1">
        <code className="text-sm font-semibold text-gray-800">{param.name}</code>
        {param.type && (
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{param.type}</span>
        )}
        {param.uiElement && (
          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
            {param.uiElement}
          </span>
        )}
        {param.required && (
          <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded">required</span>
        )}
      </div>
      {param.description && (
        <p className="text-sm text-gray-700 mb-2 whitespace-pre-wrap">{param.description}</p>
      )}
      {param.defaultValue !== undefined && param.defaultValue !== '' && (
        <p className="text-xs text-gray-500 mb-1">
          Default: <code className="text-gray-700">{String(param.defaultValue)}</code>
        </p>
      )}
      {Array.isArray(param.options) && param.options.length > 0 && (
        <div className="text-xs text-gray-500">
          Options:{' '}
          <span className="text-gray-700">
            {param.options
              .map((o) => (typeof o === 'object' ? o.label ?? o.value : o))
              .join(', ')}
          </span>
        </div>
      )}
    </div>
  );
}

function EngineDetail() {
  const { engineName } = useParams();
  const engine =
    (enginesData.engines || []).find((e) => e.name === engineName) ||
    (enginesData.engines || []).find(
      (e) => e.name.toLowerCase() === (engineName || '').toLowerCase()
    );

  return (
    <div className="engine-detail-page p-5">
      <div className="mb-4">
        <Link to="/engines" className="text-blue-600 hover:text-blue-800 no-underline">
          ← Back to Engines
        </Link>
      </div>

      {!engine ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700">
          <strong>Not found:</strong> no documentation for engine "{engineName}".
        </div>
      ) : (
        <div>
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center flex-wrap gap-3 mb-3">
              <h1 className="text-4xl font-bold text-gray-800">{engine.name}</h1>
              {engine.isTest && (
                <span className="text-xs font-semibold px-2 py-1 rounded bg-purple-100 text-purple-800">
                  Test engine
                </span>
              )}
              {engine.available === false && (
                <span className="text-xs font-semibold px-2 py-1 rounded bg-gray-200 text-gray-600">
                  Requires dependencies
                </span>
              )}
            </div>
            {engine.description && (
              <p className="text-lg text-gray-700 leading-relaxed break-words [overflow-wrap:anywhere]">
                {engine.description}
              </p>
            )}
          </div>

          {/* Supported modes */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-2">Supported modes</h2>
            {engine.supports.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {engine.supports.map((mode) => (
                  <span
                    key={mode}
                    className="bg-blue-50 text-blue-700 px-3 py-1 rounded text-sm"
                    title={MODE_LABELS[mode] || mode}
                  >
                    {mode}
                    {MODE_LABELS[mode] ? ` — ${MODE_LABELS[mode]}` : ''}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                This engine has unmet runtime dependencies in the documentation build, so its
                supported modes could not be determined. See the source for details.
              </p>
            )}
          </div>

          {/* Links */}
          <div className="mb-8 flex gap-2 flex-wrap">
            {engine.link && (
              <a
                href={engine.link}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 hover:text-gray-900 px-4 py-2 rounded text-sm font-medium no-underline"
              >
                Learn More
              </a>
            )}
            {engine.source && (
              <a
                href={engine.source}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 hover:text-gray-900 px-4 py-2 rounded text-sm font-medium no-underline"
              >
                View Source
              </a>
            )}
          </div>

          {/* Parameters */}
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-800 mb-1">Parameters</h2>
            <p className="text-sm text-gray-600 mb-4">
              The inputs this engine accepts when generating a model.
            </p>
            {Array.isArray(engine.parameters) && engine.parameters.length > 0 ? (
              <div className="grid gap-3">
                {engine.parameters.map((param) => (
                  <ParameterRow key={param.name} param={param} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                {engine.paramsError
                  ? `Parameters unavailable in this build: ${engine.paramsError}`
                  : 'No parameters documented for this engine.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default EngineDetail;
