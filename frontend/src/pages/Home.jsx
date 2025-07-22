import { Link } from 'react-router-dom';

function Home() {
  return (
    <div className="homepage">
      {/* Hero Section */}
      <div className="min-h-screen flex flex-col justify-center items-center text-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-8 text-gray-800 leading-tight">
            SD-AI
          </h1>
          <p className="text-xl sm:text-2xl text-gray-600 max-w-4xl mx-auto mb-12 leading-relaxed"> 
            SD-AI is a collection of open source AI tools (called engines) that assist with the system dynamics modeling process. 
            It's the backbone of AI functionality for applications like <a href="https://www.iseesystems.com/store/products/stella-architect.aspx" className="text-blue-600 hover:underline">Stella</a> and <a href="https://comodel.io" className="text-blue-600 hover:underline">CoModel</a>.
          </p>
          {/* Engines and Evaluations Introduction */}
          <div className="bg-gradient-to-r from-blue-50 to-green-50 p-8 sm:p-10 rounded-xl max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 sm:gap-12">
              <div className="text-center">
                <p className="text-gray-600 leading-relaxed mb-4">
                  SD-AI has a growing list of engines for tasks like creating causal loop diagrams and simulating models. 
                </p>
                <Link 
                  to="/engines"
                  className="inline-block px-6 py-3 bg-blue-600 text-white no-underline rounded-lg text-base font-semibold transition-colors duration-200 border-none cursor-pointer hover:bg-blue-700"
                >
                  Explore Engines
                </Link>
              </div>
              
              <div className="text-center">
                <p className="text-gray-600 leading-relaxed mb-4">
                  For each type of engine there is also a set of quality tests (called evals) used to benchmark performance of the engine.
                </p>
                <Link 
                  to="/evals"
                  className="inline-block px-6 py-3 bg-green-600 text-white no-underline rounded-lg text-base font-semibold transition-colors duration-200 border-none cursor-pointer hover:bg-green-700"
                >
                  View Evaluations
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content Sections */}
      <div className="px-4 py-12 sm:px-6 lg:px-8">

      {/* Goals Section */}
      <div className="mb-20 sm:mb-24">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10 text-gray-800">
          Goals
        </h2>
        <div className="bg-white p-8 sm:p-10 rounded-xl border-2 border-gray-200 shadow-sm">
          <ul className="space-y-6 text-gray-600 leading-relaxed">
            <li className="flex items-start">
              <span className="text-blue-600 mr-3 mt-1">•</span>
              <span>Provide a hub for state of the art AI modeling tools (<Link to="/engines" className="text-blue-600 hover:underline">engines</Link>) and benchmarks (<Link to="/evals" className="text-blue-600 hover:underline">evals</Link>) for system dynamics</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 mr-3 mt-1">•</span>
              <span>Create comprehensive leaderboards to answer the most important practical questions facing AI adoption: which engines perform best at a given type of task and how accurate will any engine be at my type of task right now?</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 mr-3 mt-1">•</span>
              <span>Build platform that supports a wide variety of tasks in the modeling process such as model generation, insight generation, etc</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 mr-3 mt-1">•</span>
              <span>Create standardized data formats that allow rapid integration of AI tools into current system dynamics tools and projects</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 mr-3 mt-1">•</span>
              <span>Maintain future-proof architecture with support for a wide variety of LLM vendors and non-LLM based AI strategies</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Getting Started Section */}
      <div className="mb-20 sm:mb-24">
        <div className="bg-gradient-to-r from-blue-50 to-green-50 p-8 sm:p-10 rounded-xl">
          <div className="bg-white p-8 rounded-lg shadow-sm">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4 text-gray-800 text-center">
              Start Experimenting!
            </h2>
            <p className="text-gray-600 leading-relaxed mb-6 text-lg text-center max-w-4xl mx-auto">
              The best way to get involved is to start using AI in your modeling workflow and provide feedback. 
              We recommend using{' '}
              <a 
                href="https://www.iseesystems.com/store/products/stella-architect.aspx" 
                className="text-blue-600 hover:underline font-medium"
                target="_blank"
                rel="noopener noreferrer"
              >
                Stella
              </a>
              {' '}(version 4.0 or above) or{' '}
              <a 
                href="https://comodel.io" 
                className="text-blue-600 hover:underline font-medium"
                target="_blank"
                rel="noopener noreferrer"
              >
                CoModel
              </a>
              , or you can{' '}
              <Link 
                to="/engines" 
                className="text-blue-600 hover:underline font-medium"
              >
                play with engines
              </Link>
              {' '}directly on this website.
            </p>
          </div>
        </div>
      </div>

      {/* Partnership Section */}
      <div className="bg-gray-50 p-8 sm:p-10 rounded-xl mb-20 sm:mb-24">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-8 text-gray-800">
          Made possible with support from
        </h2>
        
        {/* Partner Logos */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 sm:gap-10 mb-10 items-center justify-items-center">
          <div className="flex items-center justify-center p-4 bg-white rounded-lg shadow-sm min-h-[80px]">
            <a href="https://www.buffalo.edu/ai-data-science.html" className="text-sm font-medium text-gray-600 text-center hover:text-blue-600 transition-colors" target="_blank" rel="noopener noreferrer">University of Buffalo</a>
          </div>
          <div className="flex items-center justify-center p-4 bg-white rounded-lg shadow-sm min-h-[80px]">
            <a href="https://www.iseesystems.com" className="text-sm font-medium text-gray-600 text-center hover:text-blue-600 transition-colors" target="_blank" rel="noopener noreferrer">isee systems</a>
          </div>
          <div className="flex items-center justify-center p-4 bg-white rounded-lg shadow-sm min-h-[80px]">
            <a href="https://skipdesigned.com/" className="text-sm font-medium text-gray-600 text-center hover:text-blue-600 transition-colors" target="_blank" rel="noopener noreferrer">Skip Designed</a>
          </div>
          <div className="flex items-center justify-center p-4 bg-white rounded-lg shadow-sm min-h-[80px]">
            <a href="https://systemdynamics.org/" className="text-sm font-medium text-gray-600 text-center hover:text-blue-600 transition-colors" target="_blank" rel="noopener noreferrer">System Dynamics Society</a>
          </div>
        </div>

        <p className="text-center text-gray-600 text-sm sm:text-base">
          and collaborators around the globe 
        </p>
      </div>

      {/* Get Involved CTA */}
      <div className="mb-20 sm:mb-24 text-center">
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-8 sm:p-10 rounded-xl border-2 border-blue-100">
          <h2 className="text-2xl sm:text-3xl font-bold mb-6 text-gray-800">
            Ready to Get Involved?
          </h2>
          <p className="text-base sm:text-lg text-gray-600 mb-8 max-w-2xl mx-auto leading-relaxed">
            Join our diverse community of academics, industry experts, and software vendors shaping the future of AI-powered system dynamics.
          </p>
          <Link 
            to="/get-involved"
            className="inline-block px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white no-underline rounded-lg text-lg font-semibold transition-all duration-200 border-none cursor-pointer hover:from-blue-700 hover:to-purple-700 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
          >
            Learn How to Contribute
          </Link>
        </div>
      </div>
      </div>
    </div>
  );
}

export default Home;
