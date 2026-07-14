import { useState } from 'react';
import { Link } from 'react-router-dom';
import enginesData from '../generated/engines.json';

function EnginesList() {
  const [showTestEngines, setShowTestEngines] = useState(false);

  const allEngines = enginesData.engines || [];
  const recommendedDefaults = enginesData.recommendedDefaults || {};
  const hasTestEngines = allEngines.some((e) => e.isTest);
  const engines = showTestEngines ? allEngines : allEngines.filter((e) => !e.isTest);

  const isRecommended = (engineName, supportType) =>
    recommendedDefaults[supportType] === engineName;

  // Group engines by mode into CLD / SFD / Discussion sections
  const modeGroups = {};
  engines.forEach((engine) => {
    engine.supports.forEach((mode) => {
      if (!modeGroups[mode]) modeGroups[mode] = [];
      modeGroups[mode].push(engine);
    });
  });

  const discussionModes = ['cld-discuss', 'sfd-discuss'];
  const discussionEngines = [];
  const discussionEngineNames = new Set();
  discussionModes.forEach((mode) => {
    if (!modeGroups[mode]) return;
    modeGroups[mode].forEach((engine) => {
      if (discussionEngineNames.has(engine.name)) return;
      discussionEngineNames.add(engine.name);
      discussionEngines.push({
        ...engine,
        discussionModes: engine.supports.filter((s) => discussionModes.includes(s)),
      });
    });
  });

  const sections = [];
  if (modeGroups['cld'])
    sections.push({ title: 'CLD (Causal Loop Diagram) Engines', mode: 'cld', engines: modeGroups['cld'], hasLeaderboard: true });
  if (modeGroups['sfd'])
    sections.push({ title: 'SFD (Stock & Flow Diagram) Engines', mode: 'sfd', engines: modeGroups['sfd'], hasLeaderboard: true });
  if (discussionEngines.length > 0)
    sections.push({ title: 'Model Discussion Engines', mode: 'discussion', engines: discussionEngines, hasLeaderboard: true });

  // Modes that don't fall into the three headline sections above.
  const otherModes = Object.keys(modeGroups).filter(
    (m) => !['cld', 'sfd', ...discussionModes].includes(m)
  );
  otherModes.forEach((mode) => {
    sections.push({
      title: `${mode} Engines`,
      mode,
      engines: modeGroups[mode],
      hasLeaderboard: false,
    });
  });

  const Badge = ({ color, children }) => (
    <span className={`text-xs font-semibold px-2 py-1 rounded ${color}`}>{children}</span>
  );

  return (
    <div className="engines-page p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-10 mt-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-1">Engines</h2>
          <p className="text-sm text-gray-600 max-w-2xl">
            Engines are the open-source AI tools that power SD-AI. Each engine supports one or more
            modeling modes. Recommended engines are the defaults used by client applications.
          </p>
        </div>
        {hasTestEngines && (
          <label className="flex items-center gap-2 text-sm text-gray-700 select-none flex-shrink-0">
            <input
              type="checkbox"
              checked={showTestEngines}
              onChange={(e) => setShowTestEngines(e.target.checked)}
              className="h-4 w-4"
            />
            Show test engines
          </label>
        )}
      </div>

      {engines.length === 0 && (
        <div className="p-5 text-center text-gray-600 italic">No engines available</div>
      )}

      {sections.map((section) => (
        <div key={section.mode} className="mb-20">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-2xl text-gray-600 leading-relaxed uppercase mt-0">{section.title}</h3>
            {section.hasLeaderboard && (
              <Link
                to={`/leaderboard/${section.mode}`}
                className="border border-green-500 text-green-600 hover:bg-green-50 px-3 py-1 rounded text-sm font-medium no-underline flex-shrink-0"
              >
                Leaderboard
              </Link>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {section.engines.map((engine, index) => {
              const recommended =
                section.mode === 'discussion'
                  ? engine.discussionModes?.some((mode) => isRecommended(engine.name, mode))
                  : isRecommended(engine.name, section.mode);

              return (
                <div
                  key={`${section.mode}-${engine.name}-${index}`}
                  className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md flex flex-col min-w-0"
                >
                  <div className="flex items-start justify-between mb-3 gap-2">
                    <h4 className="text-lg font-semibold text-gray-800 break-words [overflow-wrap:anywhere] min-w-0">
                      {engine.name}
                    </h4>
                    <div className="flex flex-wrap gap-1 justify-end flex-shrink-0">
                      {recommended && <Badge color="bg-yellow-100 text-yellow-800">Recommended</Badge>}
                      {engine.isTest && <Badge color="bg-purple-100 text-purple-800">Test</Badge>}
                      {engine.available === false && (
                        <Badge color="bg-gray-200 text-gray-600">Requires dependencies</Badge>
                      )}
                    </div>
                  </div>

                  {engine.description && (
                    <div className="mb-4 text-sm text-gray-700 flex-1 min-w-0">
                      <p className="mb-2 last:mb-0 break-words [overflow-wrap:anywhere]">
                        {engine.description}
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2 flex-wrap mt-auto">
                    <Link
                      to={`/engines/${engine.name}`}
                      className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium no-underline"
                    >
                      Details
                    </Link>
                    {engine.link && (
                      <a
                        href={engine.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 hover:text-gray-900 px-3 py-2 rounded text-sm font-medium no-underline"
                        title="Read more about this engine"
                      >
                        Learn More
                      </a>
                    )}
                    {engine.source && (
                      <a
                        href={engine.source}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 hover:text-gray-900 px-3 py-2 rounded text-sm font-medium no-underline"
                        title="View source code on GitHub"
                      >
                        View Source
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default EnginesList;
