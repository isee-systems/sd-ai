import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

function EnginesList() {
  const [engines, setEngines] = useState([]);
  const [recommendedDefaults, setRecommendedDefaults] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch engines data when component mounts
  useEffect(() => {
    const fetchEngines = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await api.get('/engines');
        setEngines(response.data.engines || []);
        setRecommendedDefaults(response.data.recommendedDefaults || {});
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Failed to fetch engines');
        console.error('Error fetching engines:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchEngines();
  }, []);

  // Function to get support type description
  const getSupportDescription = (supportType) => {
    switch (supportType) {
      case 'cld':
        return 'Causal Loop Diagrams';
      case 'sfd':
        return 'Stock & Flow Diagrams';
      case 'sfd-discuss':
        return 'SFD Discussion Mode';
      case 'cld-discuss':
        return 'CLD Discussion Mode';
      default:
        return supportType;
    }
  };

  // Function to check if engine is recommended for a mode
  const isRecommended = (engineName, supportType) => {
    return recommendedDefaults[supportType] === engineName;
  };

  return (
    <div className="engines-page p-5">
      <h1 className="text-4xl font-bold mb-3 text-gray-800">
        sd-ai Engines
      </h1>
      <p className="text-lg text-gray-600 mb-8 max-w-3xl">
        Explore and interact with different AI engines for system dynamics modeling. 
        Each engine specializes in different types of diagram generation and analysis.
      </p>

      {/* Engines Data Section */}
      {loading && (
        <div className="p-5 text-center text-gray-600">
          Loading engines data...
        </div>
      )}
      
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700 mb-4">
          <strong>Error:</strong> {error}
        </div>
      )}
      
      {!loading && !error && engines.length === 0 && (
        <div className="p-5 text-center text-gray-600 italic">
          No engines available
        </div>
      )}
      
      {!loading && !error && engines.length > 0 && (
        <div>
            
            {/* Group engines by modes */}
            {(() => {
              // Create a map of modes to engines
              const modeGroups = {};
              engines.forEach(engine => {
                engine.supports.forEach(mode => {
                  if (!modeGroups[mode]) {
                    modeGroups[mode] = [];
                  }
                  modeGroups[mode].push(engine);
                });
              });
              
              // Group discussion modes together
              const discussionModes = ['cld-discuss', 'sfd-discuss'];
              const discussionEngines = [];
              const discussionEngineNames = new Set();
              
              discussionModes.forEach(mode => {
                if (modeGroups[mode]) {
                  modeGroups[mode].forEach(engine => {
                    if (!discussionEngineNames.has(engine.name)) {
                      discussionEngineNames.add(engine.name);
                      // Add all discussion modes this engine supports
                      const engineDiscussionModes = engine.supports.filter(s => discussionModes.includes(s));
                      discussionEngines.push({
                        ...engine,
                        discussionModes: engineDiscussionModes
                      });
                    }
                  });
                }
              });
              
              // Create sections: CLD, SFD, and Discussion
              const sections = [];
              
              // Add CLD section
              if (modeGroups['cld']) {
                sections.push({
                  title: 'Causal Loop Diagrams',
                  mode: 'cld',
                  engines: modeGroups['cld'],
                  hasLeaderboard: true
                });
              }
              
              // Add SFD section
              if (modeGroups['sfd']) {
                sections.push({
                  title: 'Stock & Flow Diagrams',
                  mode: 'sfd',
                  engines: modeGroups['sfd'],
                  hasLeaderboard: true
                });
              }
              
              // Add Discussion section
              if (discussionEngines.length > 0) {
                sections.push({
                  title: 'Discussion Modes',
                  mode: 'discussion',
                  engines: discussionEngines,
                  hasLeaderboard: false
                });
              }
              
              return sections.map(section => (
                <div key={section.mode} className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-gray-800">
                      {section.title}
                    </h3>
                    {section.hasLeaderboard && (
                      <Link
                        to={`/leaderboard/${section.mode}`}
                        className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded text-sm font-medium no-underline transition-colors"
                      >
                        View Leaderboard
                      </Link>
                    )}
                  </div>
                  
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {section.engines.map((engine, index) => (
                      <div key={`${section.mode}-${engine.name}-${index}`} className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-lg font-semibold text-gray-800 capitalize">
                            {engine.name}
                          </h4>
                          {(section.mode !== 'discussion' && isRecommended(engine.name, section.mode)) && (
                            <span className="bg-yellow-100 text-yellow-800 text-xs font-semibold px-2 py-1 rounded">
                              Recommended
                            </span>
                          )}
                        </div>
                        
                        {section.mode === 'discussion' ? (
                          <div className="mb-4">
                            <p className="text-sm text-gray-600 mb-2">Supports:</p>
                            <div className="flex flex-wrap gap-1">
                              {engine.discussionModes.map((mode, modeIndex) => (
                                <span key={modeIndex} className="text-xs text-gray-700">
                                  {getSupportDescription(mode)}
                                  {modeIndex < engine.discussionModes.length - 1 && ', '}
                                </span>
                              ))}
                            </div>
                            {engine.supports.filter(support => !discussionModes.includes(support)).length > 0 && (
                              <div className="mt-2">
                                <p className="text-sm text-gray-600 mb-1">Also supports:</p>
                                <div className="flex flex-wrap gap-1">
                                  {engine.supports.filter(support => !discussionModes.includes(support)).map((support, supportIndex) => (
                                    <span key={supportIndex} className="text-xs text-gray-700">
                                      {getSupportDescription(support)}
                                      {supportIndex < engine.supports.filter(s => !discussionModes.includes(s)).length - 1 && ', '}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          engine.supports.filter(support => support !== section.mode).length > 0 && (
                            <div className="mb-4">
                              <p className="text-sm text-gray-600 mb-2">Also supports:</p>
                              <div className="flex flex-wrap gap-1">
                                {engine.supports.filter(support => support !== section.mode).map((support, supportIndex) => (
                                  <span key={supportIndex} className="text-xs text-gray-700">
                                    {getSupportDescription(support)}
                                    {supportIndex < engine.supports.filter(s => s !== section.mode).length - 1 && ', '}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )
                        )}
                        
                        <div className="flex justify-between items-center">
                          <Link
                            to={`/engines/${engine.name}`}
                            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium no-underline transition-colors"
                          >
                            View Details
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ));
            })()}
        </div>
      )}
    </div>
  );
}

export default EnginesList;
