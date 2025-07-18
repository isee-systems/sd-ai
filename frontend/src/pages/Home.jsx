import { Link } from 'react-router-dom';

function Home() {
  return (
    <div className="homepage px-4 py-6 sm:px-6 lg:px-8">
      {/* Hero Section */}
      <div className="text-center mb-12 sm:mb-16">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-4 text-gray-800 leading-tight">
          SD-AI
        </h1>
        <p className="text-lg sm:text-xl text-gray-600 max-w-4xl mx-auto mb-6 leading-relaxed"> 
          SD-AI is a collection of open source AI tools (called engines) that assist with the system dynamics modeling process. 
          It's the backbone of AI functionality for applications like <a href="https://www.iseesystems.com/store/products/stella-architect.aspx" className="text-blue-600 hover:underline">Stella</a> and <a href="https://comodel.io" className="text-blue-600 hover:underline">CoModel</a>.
        </p>
        {/* Engines and Evaluations Introduction */}
        <div className="bg-gradient-to-r from-blue-50 to-green-50 p-6 sm:p-8 rounded-xl mb-8 max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
            <div className="text-center md:text-left">
              <h3 className="text-xl sm:text-2xl font-bold mb-4 text-gray-800">
                Discover the Engines
              </h3>
              <p className="text-gray-600 leading-relaxed mb-4">
                SD-AI has a growing list of <Link to="/engines" className="text-blue-600 hover:underline">engines</Link> that do things like create causal loop diagrams and simulate models. 
                Each engine is crafted to enhance the modeling workflow.
              </p>
              <Link 
                to="/engines"
                className="inline-block px-6 py-3 bg-blue-600 text-white no-underline rounded-lg text-base font-semibold transition-colors duration-200 border-none cursor-pointer hover:bg-blue-700"
              >
                Explore Engines
              </Link>
            </div>
            
            <div className="text-center md:text-left">
              <h3 className="text-xl sm:text-2xl font-bold mb-4 text-gray-800">
                Review the Evaluations
              </h3>
              <p className="text-gray-600 leading-relaxed mb-4">
                SD-AI is building system dynamics specific benchmarks evaluating AI performance across many dimensions. 
                See comprehensive <Link to="/evals" className="text-blue-600 hover:underline">evaluations</Link> that demonstrate how engines perform across different modeling tasks.
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

      {/* Goals Section */}
      <div className="mb-12 sm:mb-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-8 text-gray-800">
          Goals
        </h2>
        <div className="bg-white p-6 sm:p-8 rounded-xl border-2 border-gray-200 shadow-sm">
          <ul className="space-y-4 text-gray-600 leading-relaxed">
            <li className="flex items-start">
              <span className="text-blue-600 mr-3 mt-1">•</span>
              <span>Provide a hub for state of the art modeling tools (called <Link to="/engines" className="text-blue-600 hover:underline">engines</Link>) and benchmarks (<Link to="/evals" className="text-blue-600 hover:underline">evals</Link>) for using AI in SD modeling</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 mr-3 mt-1">•</span>
              <span>Build a diverse community of academics, industry experts, software vendors and individuals interested in guiding the development of the next generation of software for the field</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 mr-3 mt-1">•</span>
              <span>Use SD-AI <Link to="/evals" className="text-blue-600 hover:underline">evaluations</Link> to build leaderboard that answer the most important practical questions: which engines perform best at a given task and how accurate should I expect any AI to be?</span>
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
              <span>Flexible backend that can support multiple LLM vendors and non-LLM based AI strategies</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Partnership Section */}
      <div className="bg-gray-50 p-6 sm:p-8 rounded-xl mb-12 sm:mb-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-6 text-gray-800">
          Made possible by support and funding from
        </h2>
        
        {/* Partner Logos */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8 mb-8 items-center justify-items-center">
          <div className="flex items-center justify-center p-4 bg-white rounded-lg shadow-sm min-h-[80px]">
            <span className="text-sm font-medium text-gray-600 text-center">University of Buffalo</span>
          </div>
          <div className="flex items-center justify-center p-4 bg-white rounded-lg shadow-sm min-h-[80px]">
            <span className="text-sm font-medium text-gray-600 text-center">isee systems</span>
          </div>
          <div className="flex items-center justify-center p-4 bg-white rounded-lg shadow-sm min-h-[80px]">
            <span className="text-sm font-medium text-gray-600 text-center">Comodel</span>
          </div>
          <div className="flex items-center justify-center p-4 bg-white rounded-lg shadow-sm min-h-[80px]">
            <span className="text-sm font-medium text-gray-600 text-center">System Dynamics Society</span>
          </div>
        </div>

        <p className="text-center text-gray-600 text-sm sm:text-base">
          and collaborators around the globe 
        </p>
      </div>

      {/* Get Involved Section */}
      <div className="mb-12 sm:mb-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-4 text-gray-800">
          Get Involved
        </h2>
        <p className="text-base sm:text-lg text-gray-600 mb-8 max-w-2xl mx-auto text-center">
          Whether you're interested in system dynamics modeling, AI evaluation, or contributing to open source research, 
          SD-AI has something for you.
        </p>
        
        <div className="bg-gradient-to-r from-blue-50 to-green-50 p-6 sm:p-8 rounded-xl">
          {/* Introduction Card */}
          <div className="bg-white p-6 rounded-lg shadow-sm mb-8">
            <h3 className="text-lg font-bold mb-3 text-gray-800">
              Join the Community
            </h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              Join the discussion on the{' '}
              <a 
                href="https://groups.io/g/sd-ai/" 
                className="text-blue-600 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                sd-ai groups.io
              </a>
            </p>
            <p className="text-gray-600 leading-relaxed">
              SD-AI welcomes GitHub Issues and Pull Requests from everyone! Here are some ideas for how to support this work:
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 mb-8">
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="text-lg font-bold mb-3 text-gray-800">
                  Anyone with an SD background
                </h3>
                <ul className="space-y-2 text-gray-600 text-sm">
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2 mt-1">•</span>
                    <span>Feedback on your experience building CLDs in either Stella (using AI Assistant) or CoModel (using Copilot)</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2 mt-1">•</span>
                    <span>
                      Join{' '}
                      <a 
                        href="https://www.buffalo.edu/ai-data-science/research/beams.html" 
                        className="text-blue-600 hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        BEAMS
                      </a>
                      {' '}to steer the strategy for evaluating the accuracy, safety and bias of SD-AI models
                    </span>
                  </li>
                </ul>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="text-lg font-bold mb-3 text-gray-800">
                  Techy folks
                </h3>
                <ul className="space-y-2 text-gray-600 text-sm">
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2 mt-1">•</span>
                    <span>Prompt engineering recommendations surfaced by using "Advanced" Assistant in Stella</span>
                  </li>
                </ul>
              </div>
            </div>
            
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="text-lg font-bold mb-3 text-gray-800">
                  Peeps comfortable with programming
                </h3>
                <ul className="space-y-2 text-gray-600 text-sm">
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2 mt-1">•</span>
                    <span>Refinement of the `default` (the state of the art) engine or contribution of a brand new AI engine</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2 mt-1">•</span>
                    <span>Translate benchmarks outlined by BEAMS into executable code</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2 mt-1">•</span>
                    <span>
                      Add or refine the{' '}
                      <Link to="/evals" className="text-blue-600 hover:underline">
                        evals
                      </Link>
                      {' '}used to measure model performance according to{' '}
                      <a 
                        href="https://www.buffalo.edu/ai-data-science/research/beams.html" 
                        className="text-blue-600 hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        BEAMS
                      </a>
                      {' '}goals
                    </span>
                  </li>
                </ul>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="text-lg font-bold mb-3 text-gray-800">
                  SD Product Owners
                </h3>
                <ul className="space-y-2 text-gray-600 text-sm">
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2 mt-1">•</span>
                    <span>Incorporate validated AI functionality into your applications as simple with simple http request</span>
                  </li>
                </ul>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="text-lg font-bold mb-3 text-gray-800">
                  Researchers & Academics
                </h3>
                <ul className="space-y-2 text-gray-600 text-sm">
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2 mt-1">•</span>
                    <span>Contribute research papers and publications related to SD-AI methodologies</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2 mt-1">•</span>
                    <span>
                      Explore the open source codebase and contribute to the project on{' '}
                      <a 
                        href="https://github.com/dgcoskip/sd-ai-evals"
                        className="text-blue-600 hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        GitHub
                      </a>
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          
          {/* Explore the Frontend Section */}
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="text-lg font-bold mb-4 text-gray-800">
              Explore & Learn
            </h3>
            <p className="text-gray-600 leading-relaxed mb-6">
              This frontend interface provides multiple opportunities to explore SD-AI capabilities and understand how different engines perform. 
              Use these tools to familiarize yourself with the ecosystem before contributing:
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link 
                to="/engines"
                className="inline-block px-6 py-3 bg-blue-600 text-white no-underline rounded-lg text-base font-semibold transition-colors duration-200 border-none cursor-pointer hover:bg-blue-700 w-full sm:w-auto text-center"
              >
                Explore Engines
              </Link>
              <Link 
                to="/evals"
                className="inline-block px-6 py-3 bg-green-600 text-white no-underline rounded-lg text-base font-semibold transition-colors duration-200 border-none cursor-pointer hover:bg-green-700 w-full sm:w-auto text-center"
              >
                View Evaluations
              </Link>
              <Link 
                to="/leaderboard/CLD"
                className="inline-block px-6 py-3 bg-purple-600 text-white no-underline rounded-lg text-base font-semibold transition-colors duration-200 border-none cursor-pointer hover:bg-purple-700 w-full sm:w-auto text-center"
              >
                View Leaderboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;
