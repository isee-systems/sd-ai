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


  // Function to check if engine is recommended for a mode
  const isRecommended = (engineName, supportType) => {
    return recommendedDefaults[supportType] === engineName;
  };

  return (
    <div className="engines-page p-5">
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
                  title: 'CLD (Causal Loop Diagram) Engines',
                  mode: 'cld',
                  engines: modeGroups['cld'],
                  hasLeaderboard: true
                });
              }
              
              // Add SFD section
              if (modeGroups['sfd']) {
                sections.push({
                  title: 'SFD (Stock & Flow Diagram) Engines',
                  mode: 'sfd',
                  engines: modeGroups['sfd'],
                  hasLeaderboard: true
                });
              }
              
              // Add Discussion section
              if (discussionEngines.length > 0) {
                sections.push({
                  title: 'Model Discussion Engines',
                  mode: 'discussion',
                  engines: discussionEngines,
                  hasLeaderboard: false
                });
              }
              
              return sections.map(section => (
                <div key={section.mode} className="mb-20">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl text-2xl text-gray-600 leading-relaxed uppercase mt-0">
                      {section.title}
                    </h3>
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
                    {section.engines.map((engine, index) => (
                      <div key={`${section.mode}-${engine.name}-${index}`} className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-lg font-semibold text-gray-800">
                            {engine.name}
                          </h4>
                          {(() => {
                            if (section.mode === 'discussion') {
                              // For discussion mode, check if engine is recommended for any discussion mode
                              const isRecommendedForDiscussion = engine.discussionModes?.some(mode => 
                                isRecommended(engine.name, mode)
                              );
                              return isRecommendedForDiscussion && (
                                <span className="bg-yellow-100 text-yellow-800 text-xs font-semibold px-2 py-1 rounded">
                                  Recommended
                                </span>
                              );
                            } else {
                              // For non-discussion modes, use existing logic
                              return isRecommended(engine.name, section.mode) && (
                                <span className="bg-yellow-100 text-yellow-800 text-xs font-semibold px-2 py-1 rounded">
                                  Recommended
                                </span>
                              );
                            }
                          })()}
                        </div>
                        
                        {/* Engine Description */}
                        {engine.description && (
                          <div className="mb-4 text-sm text-gray-700">
                            <p className="mb-2 last:mb-0">{engine.description}</p>
                          </div>
                        )}
                        

                        
                        <div className="flex justify-between items-center">
                          <div className="flex gap-2">
                            <Link
                              to={`/engines/${engine.name}`}
                              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium no-underline"
                            >
                              Try it
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
