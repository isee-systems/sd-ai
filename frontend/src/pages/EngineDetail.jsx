import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';

function EngineDetail() {
  const { engineName } = useParams();
  const [engine, setEngine] = useState(null);
  const [parameters, setParameters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    prompt: '',
    format: 'sd-json',
    currentModel: null
  });
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [generationError, setGenerationError] = useState(null);

  // Fetch engine details when component mounts
  useEffect(() => {
    const fetchEngineDetails = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch list of engines to get basic info
        const enginesResponse = await api.get('/engines');
        const engineData = enginesResponse.data.engines?.find(e => e.name === engineName);
        
        if (!engineData) {
          throw new Error(`Engine "${engineName}" not found`);
        }
        
        setEngine(engineData);
        
        // Fetch engine parameters
        const parametersResponse = await api.get(`/engines/${engineName}/parameters`);
        const params = parametersResponse.data.parameters || [];
        setParameters(params);
        
        // Initialize form data with default values
        const initialFormData = {
          prompt: '',
          format: 'sd-json',
          currentModel: null
        };
        
        // Add default values for additional parameters
        params.forEach(param => {
          if (param.defaultValue !== undefined) {
            initialFormData[param.name] = param.defaultValue;
          } else {
            // Set appropriate default based on type
            switch (param.type) {
              case 'boolean':
                initialFormData[param.name] = false;
                break;
              case 'number':
                initialFormData[param.name] = 0;
                break;
              default:
                initialFormData[param.name] = '';
            }
          }
        });
        
        setFormData(initialFormData);
        
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Failed to fetch engine details');
        console.error('Error fetching engine details:', err);
      } finally {
        setLoading(false);
      }
    };

    if (engineName) {
      fetchEngineDetails();
    }
  }, [engineName]);

  // Handle form field changes
  const handleInputChange = (paramName, value) => {
    setFormData(prev => ({
      ...prev,
      [paramName]: value
    }));
  };

  // Handle form submission
  const handleGenerate = async (e) => {
    e.preventDefault();
    setGenerating(true);
    setGenerationError(null);
    setResult(null);

    try {
      const response = await api.post(`/engines/${engineName}/generate`, formData);
      setResult(response.data);
    } catch (err) {
      setGenerationError(err.response?.data?.message || err.message || 'Generation failed');
      console.error('Generation error:', err);
    } finally {
      setGenerating(false);
    }
  };

  // Render form input based on parameter type
  const renderFormInput = (param) => {
    const value = formData[param.name] || '';
    
    switch (param.uiElement) {
      case 'textarea':
        return (
          <textarea
            id={param.name}
            value={value}
            onChange={(e) => handleInputChange(param.name, e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder={param.description}
            required={param.required}
            style={{
              minHeight: param.minHeight ? `${param.minHeight}px` : '100px',
              maxHeight: param.maxHeight ? `${param.maxHeight}px` : 'none'
            }}
          />
        );
      
      case 'password':
        return (
          <input
            type="password"
            id={param.name}
            value={value}
            onChange={(e) => handleInputChange(param.name, e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder={param.description}
            required={param.required}
          />
        );
      
      case 'combobox':
        return (
          <select
            id={param.name}
            value={value}
            onChange={(e) => handleInputChange(param.name, e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required={param.required}
          >
            <option value="">Select an option</option>
            {param.options?.map((option, index) => (
              <option key={index} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );
      
      case 'checkbox':
        return (
          <input
            type="checkbox"
            id={param.name}
            checked={value === true || value === 'true'}
            onChange={(e) => handleInputChange(param.name, e.target.checked)}
            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
          />
        );
      
      case 'hidden':
        return (
          <input
            type="hidden"
            id={param.name}
            value={value}
            onChange={(e) => handleInputChange(param.name, e.target.value)}
          />
        );
      
      case 'lineedit':
      default:
        return (
          <input
            type={param.type === 'number' ? 'number' : 'text'}
            id={param.name}
            value={value}
            onChange={(e) => handleInputChange(param.name, e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder={param.description}
            required={param.required}
          />
        );
    }
  };

  // Function to get badge color based on support type
  const getBadgeColor = (supportType) => {
    switch (supportType) {
      case 'cld':
        return 'bg-blue-100 text-blue-800';
      case 'sfd':
        return 'bg-green-100 text-green-800';
      case 'sfd-discuss':
        return 'bg-purple-100 text-purple-800';
      case 'cld-discuss':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

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

  return (
    <div className="engine-detail-page p-5">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link 
          to="/engines"
          className="text-blue-600 hover:text-blue-800 no-underline"
        >
          ← Back to Engines
        </Link>
      </div>

      {loading && (
        <div className="p-5 text-center text-gray-600">
          Loading engine details...
        </div>
      )}
      
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700 mb-4">
          <strong>Error:</strong> {error}
        </div>
      )}
      
      {!loading && !error && engine && (
        <div>
          {/* Engine Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold mb-3 text-gray-800 capitalize">
              {engine.name} Engine
            </h1>
            
            <div className="mb-4">
              <p className="text-lg text-gray-600 mb-2">Supported Modes:</p>
              <div className="flex flex-wrap gap-2">
                {engine.supports.map((support, index) => (
                  <span
                    key={index}
                    className={`inline-block px-3 py-1 text-sm font-semibold rounded ${getBadgeColor(support)}`}
                    title={getSupportDescription(support)}
                  >
                    {support.toUpperCase()} - {getSupportDescription(support)}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Model Generation Form */}
          <div className="mb-8 p-5 border-2 border-gray-200 rounded-lg bg-gray-50">
            <h2 className="mt-0 mb-4 text-xl font-bold text-gray-800">
              Generate Model
            </h2>
            
            <form onSubmit={handleGenerate} className="space-y-4">
              {/* Prompt field */}
              <div>
                <label htmlFor="prompt" className="block text-sm font-medium text-gray-700 mb-1">
                  Prompt <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="prompt"
                  value={formData.prompt}
                  onChange={(e) => handleInputChange('prompt', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your model description or changes you want to make..."
                  required
                  rows={3}
                />
              </div>

              {/* Format field */}
              <div>
                <label htmlFor="format" className="block text-sm font-medium text-gray-700 mb-1">
                  Output Format
                </label>
                <select
                  id="format"
                  value={formData.format}
                  onChange={(e) => handleInputChange('format', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="sd-json">SD-JSON</option>
                  <option value="xmile">XMILE</option>
                </select>
              </div>

              {/* Dynamic parameter fields */}
              {parameters.filter(param => !['prompt', 'format', 'currentModel'].includes(param.name)).map((param) => (
                param.uiElement !== 'hidden' && (
                  <div key={param.name}>
                    <label htmlFor={param.name} className="block text-sm font-medium text-gray-700 mb-1">
                      {param.label || param.name}
                      {param.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {renderFormInput(param)}
                    {param.description && (
                      <p className="text-xs text-gray-500 mt-1">{param.description}</p>
                    )}
                  </div>
                )
              ))}

              {/* Hidden fields */}
              {parameters.filter(param => !['prompt', 'format', 'currentModel'].includes(param.name)).map((param) => (
                param.uiElement === 'hidden' && (
                  <div key={param.name}>
                    {renderFormInput(param)}
                  </div>
                )
              ))}

              {/* Submit button */}
              <div className="pt-4">
                <button
                  type="submit"
                  disabled={generating}
                  className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-6 py-3 rounded font-medium transition-colors"
                >
                  {generating ? 'Generating...' : 'Generate Model'}
                </button>
              </div>
            </form>

            {/* Generation error */}
            {generationError && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded text-red-700">
                <strong>Error:</strong> {generationError}
              </div>
            )}

            {/* Generation result */}
            {result && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded">
                <h3 className="font-semibold text-green-800 mb-2">Generation Result:</h3>
                {result.success ? (
                  <div>
                    <p className="text-green-700 mb-2">
                      <strong>Format:</strong> {result.format}
                    </p>
                    <div className="bg-white p-3 rounded border max-h-96 overflow-auto">
                      <pre className="text-sm text-gray-800 whitespace-pre-wrap">
                        {JSON.stringify(result.model, null, 2)}
                      </pre>
                    </div>
                    {result.supportingInfo && (
                      <div className="mt-3">
                        <h4 className="font-medium text-green-800 mb-1">Supporting Information:</h4>
                        <div className="bg-white p-3 rounded border max-h-48 overflow-auto">
                          <pre className="text-sm text-gray-800 whitespace-pre-wrap">
                            {JSON.stringify(result.supportingInfo, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-red-700">Generation failed: {result.message || 'Unknown error'}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default EngineDetail;
