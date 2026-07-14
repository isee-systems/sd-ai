import { useState } from 'react';
import { Link } from 'react-router-dom';
import evalsData from '../generated/evals.json';

function EvalsList() {
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const categories = evalsData.categories || [];

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

  return (
    <div className="evals-page p-5">
      <div className="mb-8">
        <h3 className="text-xl sm:text-2xl text-gray-600 leading-relaxed uppercase mb-6 mt-12">
          Evaluation Categories
        </h3>
        <p className="text-sm text-gray-600 max-w-3xl mb-12">
          Evaluations (evals) are the quality tests used to benchmark engine performance. Each
          category contains groups of individual test cases with a prompt and a set of expectations.
        </p>
      </div>

      {categories.length === 0 && (
        <div className="p-8 text-center text-gray-600 italic">No evals data available</div>
      )}

      {categories.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {categories.map((category, categoryIndex) => (
            <div
              key={categoryIndex}
              className="bg-white rounded-lg shadow-md border border-gray-200 hover:shadow-lg flex flex-col"
            >
              <div className="p-6 flex-1">
                <h3 className="text-xl font-bold mb-3 text-gray-800">{category.name}</h3>
                {category.description && (
                  <div className="mb-4 text-sm text-gray-700">
                    <p className="mb-2 last:mb-0 leading-relaxed">{category.description}</p>
                  </div>
                )}
                <div className="space-y-3">
                  {category.groups.map((group, groupIndex) => {
                    const groupKey = `${category.name}-${group.name}`;
                    const isExpanded = expandedGroups.has(groupKey);

                    return (
                      <div key={groupIndex}>
                        <h4
                          onClick={() => toggleGroupExpansion(category.name, group.name)}
                          className="text-sm font-semibold mb-2 text-gray-700 cursor-pointer flex items-center"
                        >
                          <svg
                            className={`w-3 h-3 mr-2 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                          {group.name} ({group.tests.length} tests)
                        </h4>
                        {isExpanded && (
                          <ul className="list-disc ml-5 text-xs text-gray-600 space-y-1">
                            {group.tests.map((test, testIndex) => (
                              <li key={testIndex}>
                                <Link
                                  to={`/evals/${encodeURIComponent(category.name)}/${encodeURIComponent(group.name)}/${encodeURIComponent(test.name)}`}
                                  className="text-blue-600 underline"
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
              <div className="p-6 pt-0">
                <div className="flex gap-2">
                  {category.firstTestUrl && (
                    <Link
                      to={category.firstTestUrl}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm font-medium no-underline inline-block"
                      title="Browse tests in this category"
                    >
                      Browse
                    </Link>
                  )}
                  {category.link && (
                    <a
                      href={category.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 hover:text-gray-900 px-3 py-2 rounded text-sm font-medium no-underline inline-block"
                      title="Read more about this evaluation category"
                    >
                      Learn More
                    </a>
                  )}
                  {category.source && (
                    <a
                      href={category.source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 hover:text-gray-900 px-3 py-2 rounded text-sm font-medium no-underline inline-block"
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
      )}
    </div>
  );
}

export default EvalsList;
