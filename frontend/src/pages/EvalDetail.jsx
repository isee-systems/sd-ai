import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';

function EvalDetail() {
  const { category, group, testname } = useParams();
  const [problemStatement, setProblemStatement] = useState('');
  const [backgroundKnowledge, setBackgroundKnowledge] = useState('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [jsonExpectations, setJsonExpectations] = useState('');
  const [navigation, setNavigation] = useState(null);

  // Fetch test details when component mounts or params change
  useEffect(() => {
    const fetchTestDetails = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // URL decode the test name for the API call
        const decodedTestName = decodeURIComponent(testname);
        const decodedCategory = decodeURIComponent(category);
        const decodedGroup = decodeURIComponent(group);
        
        const response = await api.get(`/evals/${decodedCategory}/${decodedGroup}/${encodeURIComponent(decodedTestName)}`);
        
        const test = response.data.test;
        
        // Set navigation data
        setNavigation(response.data.navigation);
        
        // Load the data into the UI
        setProblemStatement(test.additionalParameters?.problemStatement || '');
        setBackgroundKnowledge(test.additionalParameters?.backgroundKnowledge || '');
        setPrompt(test.prompt || '');
        
        // Set the expectations as JSON text
        if (test.expectations) {
          setJsonExpectations(JSON.stringify(test.expectations, null, 2));
        } else {
          setJsonExpectations('');
        }
        
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Failed to load test details');
        console.error('Error loading test details:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTestDetails();
  }, [category, group, testname]);

  const decodedTestName = decodeURIComponent(testname);
  const decodedCategory = decodeURIComponent(category);
  const decodedGroup = decodeURIComponent(group);

  return (
    <div className="eval-detail-page">
      {/* Sticky Navigation Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm mb-6">
        <div className="p-4">
          {/* Current Location */}
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
            
            {/* Back to List Link */}
            <Link 
              to="/evals" 
              className="text-sm text-gray-600 hover:text-blue-600 underline flex-shrink-0"
            >
              ← Back to All Evaluations
            </Link>
          </div>          {/* Navigation Controls */}
          {navigation && (navigation.nextTest || navigation.nextGroup || navigation.previousTest || navigation.previousGroup) && (
            <div className="border-t border-gray-200 pt-4">
              <div className="flex flex-col space-y-3 md:flex-row md:items-center md:justify-between md:space-y-0">
                {/* Previous Navigation */}
                <div className="flex flex-wrap gap-2">
                  {navigation.previousGroup && (
                    <Link
                      to={navigation.previousGroup.url}
                      className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors duration-200 text-sm font-medium"
                      title={`Go to group: ${navigation.previousGroup.name || 'Previous Group'}`}
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
                      className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors duration-200 text-sm"
                      title={`Go to test: ${navigation.previousTest.name || 'Previous Test'}`}
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      Previous Test
                    </Link>
                  )}
                </div>

                {/* Current Position Indicator */}
                <div className="text-sm text-gray-600 font-medium text-center">
                  {navigation.currentPosition && (
                    <div className="mb-1">
                      Test {navigation.currentPosition.test} of {navigation.currentPosition.totalTests}
                      {navigation.currentPosition.group && ` | Group ${navigation.currentPosition.group} of ${navigation.currentPosition.totalGroups}`}
                    </div>
                  )}
                </div>

                {/* Next Navigation */}
                <div className="flex flex-wrap gap-2">
                  {navigation.nextTest && (
                    <Link
                      to={navigation.nextTest.url}
                      className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200 text-sm"
                      title={`Go to test: ${navigation.nextTest.name || 'Next Test'}`}
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
                      className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200 text-sm font-medium"
                      title={`Go to group: ${navigation.nextGroup.name || 'Next Group'}`}
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
        {loading && (
          <div className="p-8 text-center text-gray-600">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            Loading test details...
          </div>
        )}
        
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 mb-6">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <strong>Error:</strong> {error}
            </div>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Test Details Section */}
            <div className="grid gap-6 mb-8">
              {/* Problem Statement */}
              {problemStatement && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-semibold text-blue-900 mb-2">Problem Statement</h3>
                  <div className="text-blue-800 text-sm whitespace-pre-wrap leading-relaxed">
                    {problemStatement}
                  </div>
                </div>
              )}

              {/* Background Knowledge */}
              {backgroundKnowledge && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 className="font-semibold text-green-900 mb-2">Background Knowledge</h3>
                  <div className="text-green-800 text-sm whitespace-pre-wrap leading-relaxed">
                    {backgroundKnowledge}
                  </div>
                </div>
              )}

              {/* Prompt */}
              {prompt && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <h3 className="font-semibold text-purple-900 mb-2">Prompt</h3>
                  <div className="text-purple-800 text-sm whitespace-pre-wrap leading-relaxed">
                    {prompt}
                  </div>
                </div>
              )}
            </div>

            {/* Expectations */}
            {jsonExpectations && jsonExpectations !== '{}' && jsonExpectations !== '[]' && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-2">Expectations</h3>
                <pre className="w-full text-gray-800 text-sm font-mono bg-transparent whitespace-pre-wrap">
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
