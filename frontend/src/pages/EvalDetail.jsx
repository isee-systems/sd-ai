import { useParams, Link } from 'react-router-dom';
import evalsData from '../generated/evals.json';

// Calculate prev/next navigation for a specific test.
function calculateNavigation(categories, currentCategory, currentGroup, currentTestName) {
  const empty = { nextTest: null, nextGroup: null, previousTest: null, previousGroup: null };

  const category = categories.find((cat) => cat.name === currentCategory);
  if (!category) return empty;

  const groups = category.groups;
  const groupNames = groups.map((g) => g.name);
  const currentGroupIndex = groupNames.indexOf(currentGroup);
  const currentGroupData = groups.find((g) => g.name === currentGroup);
  if (!currentGroupData) return empty;

  const currentTestIndex = currentGroupData.tests.findIndex((t) => t.name === currentTestName);

  const makeLink = (group, testName) =>
    `/evals/${encodeURIComponent(currentCategory)}/${encodeURIComponent(group)}/${encodeURIComponent(testName)}`;

  let nextTest = null;
  let nextGroup = null;
  let previousTest = null;
  let previousGroup = null;

  if (currentTestIndex >= 0 && currentTestIndex < currentGroupData.tests.length - 1) {
    const t = currentGroupData.tests[currentTestIndex + 1];
    nextTest = { url: makeLink(currentGroup, t.name) };
  }
  if (currentTestIndex > 0) {
    const t = currentGroupData.tests[currentTestIndex - 1];
    previousTest = { url: makeLink(currentGroup, t.name) };
  }
  if (currentGroupIndex >= 0 && currentGroupIndex < groups.length - 1) {
    const g = groups[currentGroupIndex + 1];
    if (g && g.tests.length > 0)
      nextGroup = {
        url: `/evals/${encodeURIComponent(currentCategory)}/${encodeURIComponent(g.name)}/${encodeURIComponent(g.tests[0].name)}`,
      };
  }
  if (currentGroupIndex > 0) {
    const g = groups[currentGroupIndex - 1];
    if (g && g.tests.length > 0) {
      const last = g.tests[g.tests.length - 1];
      previousGroup = {
        url: `/evals/${encodeURIComponent(currentCategory)}/${encodeURIComponent(g.name)}/${encodeURIComponent(last.name)}`,
      };
    }
  }

  return { nextTest, nextGroup, previousTest, previousGroup };
}

function EvalDetail() {
  const { category, group, testname } = useParams();
  const decodedCategory = decodeURIComponent(category);
  const decodedGroup = decodeURIComponent(group);
  const decodedTestName = decodeURIComponent(testname);

  const categories = evalsData.categories || [];
  const categoryData = categories.find((c) => c.name === decodedCategory);
  const groupData = categoryData?.groups.find((g) => g.name === decodedGroup);
  const test = groupData?.tests.find((t) => t.name === decodedTestName);

  const navigation = calculateNavigation(categories, decodedCategory, decodedGroup, decodedTestName);

  const problemStatement = test?.additionalParameters?.problemStatement || '';
  const backgroundKnowledge = test?.additionalParameters?.backgroundKnowledge || '';
  const prompt = test?.prompt || '';
  const jsonExpectations = test?.expectations
    ? JSON.stringify(test.expectations, null, 2)
    : '';

  return (
    <div className="eval-detail-page">
      {/* Sticky Navigation Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm mb-6">
        <div className="p-4">
          <div className="flex flex-col space-y-3 mb-4 md:flex-row md:items-center md:justify-between md:space-y-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm md:text-lg">
              <span className="text-gray-500">Category:</span>
              <span className="font-medium text-gray-800">{decodedCategory}</span>
              <span className="text-gray-400">›</span>
              <span className="text-gray-500">Group:</span>
              <span className="font-medium text-gray-800">{decodedGroup}</span>
              <span className="text-gray-400">›</span>
              <span className="text-gray-500">Test:</span>
              <span className="font-semibold text-blue-600">{decodedTestName}</span>
            </div>

            <Link
              to="/evals"
              className="text-sm text-gray-600 hover:text-blue-600 underline flex-shrink-0"
            >
              ← Back to All Evaluations
            </Link>
          </div>

          {(navigation.nextTest || navigation.nextGroup || navigation.previousTest || navigation.previousGroup) && (
            <div className="border-t border-gray-200 pt-4">
              <div className="flex flex-col space-y-3 md:flex-row md:items-center md:justify-between md:space-y-0">
                <div className="flex flex-wrap gap-2">
                  {navigation.previousGroup && (
                    <Link
                      to={navigation.previousGroup.url}
                      className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm font-medium"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                      </svg>
                      Previous Group
                    </Link>
                  )}
                  {navigation.previousTest && (
                    <Link
                      to={navigation.previousTest.url}
                      className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      Previous Test
                    </Link>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {navigation.nextTest && (
                    <Link
                      to={navigation.nextTest.url}
                      className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                    >
                      Next Test
                      <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  )}
                  {navigation.nextGroup && (
                    <Link
                      to={navigation.nextGroup.url}
                      className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
                    >
                      Next Group
                      <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="p-5">
        {!test ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 mb-6">
            <strong>Not found:</strong> no test "{decodedTestName}" in {decodedCategory} ›{' '}
            {decodedGroup}.
          </div>
        ) : (
          <>
            <div className="grid gap-6 mb-8">
              {problemStatement && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-semibold text-blue-900 mb-2">Problem Statement</h3>
                  <div className="text-blue-800 text-sm whitespace-pre-wrap leading-relaxed">
                    {problemStatement}
                  </div>
                </div>
              )}

              {backgroundKnowledge && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 className="font-semibold text-green-900 mb-2">Background Knowledge</h3>
                  <div className="text-green-800 text-sm whitespace-pre-wrap leading-relaxed">
                    {backgroundKnowledge}
                  </div>
                </div>
              )}

              {prompt && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <h3 className="font-semibold text-purple-900 mb-2">Prompt</h3>
                  <div className="text-purple-800 text-sm whitespace-pre-wrap leading-relaxed">
                    {prompt}
                  </div>
                </div>
              )}
            </div>

            {jsonExpectations && jsonExpectations !== '{}' && jsonExpectations !== '[]' && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-2">Expectations</h3>
                <pre className="w-full text-gray-800 text-sm font-mono bg-transparent whitespace-pre-wrap overflow-x-auto">
                  {jsonExpectations}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default EvalDetail;
