import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

function EvalsList() {
  const [evals, setEvals] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [expandedDescriptions, setExpandedDescriptions] = useState(new Set());

  // Fetch evals data when component mounts
  useEffect(() => {
    const fetchEvals = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await api.get('/evals');
        setEvals(response.data);
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Failed to fetch evals');
        console.error('Error fetching evals:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchEvals();
  }, []);

  // Function to toggle group expansion
  const toggleGroupExpansion = (categoryName, groupName) => {
    const groupKey = `${categoryName}-${groupName}`;
    const newExpandedGroups = new Set(expandedGroups);
    
    if (newExpandedGroups.has(groupKey)) {
      newExpandedGroups.delete(groupKey);
    } else {
      newExpandedGroups.add(groupKey);
    }
    
    setExpandedGroups(newExpandedGroups);
  };

  // Function to toggle description expansion
  const toggleDescriptionExpansion = (categoryName) => {
    const newExpandedDescriptions = new Set(expandedDescriptions);
    
    if (newExpandedDescriptions.has(categoryName)) {
      newExpandedDescriptions.delete(categoryName);
    } else {
      newExpandedDescriptions.add(categoryName);
    }
    
    setExpandedDescriptions(newExpandedDescriptions);
  };

  // Function to truncate text
  const truncateText = (text, maxLength = 150) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  };

  return (
    <div className="evals-page p-5">
      <h1 className="text-4xl font-bold mb-3 text-gray-800">
        sd-ai Evaluations
      </h1>
      <p className="text-lg text-gray-600 mb-8 max-w-3xl">
        Browse and explore evaluations for AI systems using our comprehensive testing framework.
      </p>

      {/* Evals Data Section */}
      <div className="mb-8">
        <h2 className="mt-0 mb-6 text-2xl font-bold text-gray-800">
          Available Evaluations
        </h2>
        
        {loading && (
          <div className="p-8 text-center text-gray-600">
            Loading evals data...
          </div>
        )}
        
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 mb-6">
            <strong>Error:</strong> {error}
          </div>
        )}
        
        {!loading && !error && evals.length === 0 && (
          <div className="p-8 text-center text-gray-600 italic">
            No evals data available
          </div>
        )}
        
        {!loading && !error && evals.categories && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {evals.categories.map((category, categoryIndex) => (
              <div key={categoryIndex} className="bg-white rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition-shadow duration-200">
                <div className="p-6">
                  <h3 className="text-xl font-bold mb-3 text-gray-800">
                    {category.name}
                  </h3>
                  {category.description && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {expandedDescriptions.has(category.name) 
                          ? category.description 
                          : truncateText(category.description)
                        }
                      </p>
                      {category.description.length > 150 && (
                        <button
                          onClick={() => toggleDescriptionExpansion(category.name)}
                          className="text-blue-600 hover:text-blue-800 text-sm mt-2 transition-colors duration-200"
                        >
                          {expandedDescriptions.has(category.name) ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="space-y-3">
                    {category.groups.map((group, groupIndex) => {
                      const groupKey = `${category.name}-${group.name}`;
                      const isExpanded = expandedGroups.has(groupKey);
                      
                      return (
                        <div key={groupIndex} className="border-l-2 border-gray-200 pl-4">
                          <h4 
                            onClick={() => toggleGroupExpansion(category.name, group.name)}
                            className="text-sm font-semibold mb-2 text-gray-700 cursor-pointer flex items-center py-1 rounded transition-colors duration-200 hover:bg-gray-100"
                          >
                            <span className={`mr-2 text-xs transition-transform duration-200 ${isExpanded ? 'rotate-90' : 'rotate-0'}`}>
                              ▶
                            </span>
                            {group.name} ({group.tests.length} tests)
                          </h4>
                          {isExpanded && (
                            <ul className="list-disc ml-5 text-xs text-gray-600 space-y-1">
                              {group.tests.map((test, testIndex) => (
                                <li key={testIndex}>
                                  <Link
                                    to={`/evals/${encodeURIComponent(category.name)}/${encodeURIComponent(group.name)}/${encodeURIComponent(test.name)}`}
                                    className="text-blue-600 underline cursor-pointer text-xs hover:text-blue-800 transition-colors duration-200"
                                  >
                                    {test.name}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default EvalsList;
