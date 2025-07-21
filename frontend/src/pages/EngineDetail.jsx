import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';

// Auto-resizing textarea component
function AutoResizeTextarea({ value, onChange, className, placeholder, required, id }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set height to scrollHeight to expand to content
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      id={id}
      value={value}
      onChange={onChange}
      className={`${className} resize-none overflow-hidden`}
      placeholder={placeholder}
      required={required}
      style={{ minHeight: '2.5rem' }}
    />
  );
}

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
      // Process form data to handle JSON fields
      const processedFormData = { ...formData };
      
      parameters.forEach(param => {
        if (param.type === 'json' && processedFormData[param.name]) {
          try {
            // Parse JSON string into object
            processedFormData[param.name] = JSON.parse(processedFormData[param.name]);
          } catch (err) {
            throw new Error(`Invalid JSON in field "${param.label || param.name}": ${err.message}`);
          }
        }
      });

      const response = await api.post(`/engines/${engineName}/generate`, processedFormData);
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
    const baseClassName = "w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent";
    const hiddenClassName = param.uiElement === 'hidden' ? `${baseClassName} bg-gray-100` : baseClassName;
    
    switch (param.uiElement) {
      case 'textarea':
        return (
          <AutoResizeTextarea
            id={param.name}
            value={value}
            onChange={(e) => handleInputChange(param.name, e.target.value)}
            className={hiddenClassName}
            required={param.required}
          />
        );
      
      case 'password':
        return (
          <input
            type="password"
            id={param.name}
            value={value}
            onChange={(e) => handleInputChange(param.name, e.target.value)}
            className={hiddenClassName}
            required={param.required}
          />
        );
      
      case 'combobox':
        return (
          <select
            id={param.name}
            value={value}
            onChange={(e) => handleInputChange(param.name, e.target.value)}
            className={hiddenClassName}
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
      case 'lineedit':
      default:
        // Handle JSON type fields with textarea for better editing
        if (param.type === 'json') {
          return (
            <AutoResizeTextarea
              id={param.name}
              value={value}
              onChange={(e) => handleInputChange(param.name, e.target.value)}
              className={hiddenClassName}
              required={param.required}
            />
          );
        }
        
        return (
          <input
            type={param.type === 'number' ? 'number' : 'text'}
            id={param.name}
            value={value}
            onChange={(e) => handleInputChange(param.name, e.target.value)}
            className={hiddenClassName}
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
            <h1 className="text-4xl font-bold mb-3 text-gray-800">
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
                    {support} - {getSupportDescription(support)}
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
              {/* Render all parameters dynamically */}
              {parameters.map((param) => (
                <div key={param.name}>
                  <label htmlFor={param.name} className="block text-sm font-medium text-gray-700 mb-1">
                    {param.label || param.name}
                    {param.required && <span className="text-red-500 ml-1">*</span>}
                    {param.description && (
                      <span className="text-gray-500 font-normal"> - {param.description}</span>
                    )}
                  </label>
                  {renderFormInput(param)}
                </div>
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
                    <div className="bg-white p-3 rounded border">
                      <pre className="text-sm text-gray-800 whitespace-pre-wrap">
                        {JSON.stringify(result.model, null, 2)}
                      </pre>
                    </div>
                    {result.supportingInfo && (
                      <div className="mt-3">
                        <h4 className="font-medium text-green-800 mb-1">Supporting Information:</h4>
                        <div className="bg-white p-3 rounded border">
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
