import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import AutoResizeTextarea from '../components/AutoResizeTextarea';

function EngineDetail() {
  const { engineName } = useParams();
  const [engine, setEngine] = useState(null);
  const [parameters, setParameters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({});
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [generationError, setGenerationError] = useState(null);

  // Fetch engine details when component mounts
  useEffect(() => {
    const fetchEngineDetails = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch engine parameters directly (this will also validate the engine exists)
        const parametersResponse = await api.get(`/engines/${engineName}/parameters`);
        
        if (!parametersResponse.data.success) {
          throw new Error(parametersResponse.data.message || `Engine "${engineName}" not found`);
        }
        
        const params = parametersResponse.data.parameters || [];
        setParameters(params);
        
        // Set basic engine info from the name
        setEngine({ name: engineName });
        
        // Initialize form data with default values
        const initialFormData = {};
        
        // Add default values for parameters if they exist
        params.forEach(param => {
          if (param.defaultValue !== undefined) {
            initialFormData[param.name] = param.defaultValue;
          } else {
            // Leave field blank if no default value is provided
            initialFormData[param.name] = '';
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
      // Process form data to handle non-string types 
      const processedFormData = { ...formData };
      
      parameters.forEach(param => {
        const value = processedFormData[param.name];
        
        if (param.type === 'json') {
          if (value && value.trim() !== '') {
            try {
              // Parse JSON string into object
              processedFormData[param.name] = JSON.parse(value);
            } catch (err) {
              throw new Error(`Invalid JSON in field "${param.label || param.name}": ${err.message}`);
            }
          } else {
            // Remove empty JSON fields from the request
            delete processedFormData[param.name];
          }
        } else if (param.type === 'number') {
          if (value !== '' && value !== undefined && value !== null) {
            // Convert number strings to actual numbers
            processedFormData[param.name] = Number(value);
          } else {
            // Remove empty number fields from the request
            delete processedFormData[param.name];
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
    
    switch (param.uiElement) {
      case 'combobox':
        return (
          <select
            id={param.name}
            value={value}
            onChange={(e) => handleInputChange(param.name, e.target.value)}
            className={baseClassName}
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
      
      default:
        // Default to number input for number types, otherwise fallback to textarea
        if (param.type === 'number') {
          return (
            <input
              type="number"
              id={param.name}
              value={value}
              onChange={(e) => handleInputChange(param.name, e.target.value)}
              className={baseClassName}
              required={param.required}
            />
          );
        }
        
        // For all other types (including text, json, textarea, etc.), use textarea
        return (
          <AutoResizeTextarea
            id={param.name}
            value={value}
            onChange={(e) => handleInputChange(param.name, e.target.value)}
            className={baseClassName}
            required={param.required}
          />
        );
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
                    <span className={param.required ? "font-bold" : ""}>
                      {param.name}
                    </span>
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
                  className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-6 py-3 rounded font-medium"
                >
                  {generating ? 'Generating...' : 'Submit'}
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
                    <div className="bg-white rounded border">
                      <AutoResizeTextarea
                        value={JSON.stringify(result, null, 2)}
                        onChange={() => {}} // Read-only
                        className="w-full p-3 font-mono text-sm text-gray-800 border-0 bg-transparent focus:ring-0 focus:outline-none"
                        readOnly
                        minHeight="4rem"
                      />
                    </div>
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
