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
            SD-AI is a collection of open source AI tools (called engines) that assist with the dynamic modeling process.  
            It's the backbone of AI functionality for applications like <a href="https://www.iseesystems.com/store/products/stella-architect.aspx" className="text-blue-600 hover:underline">Stella</a> and <a href="https://comodel.io" className="text-blue-600 hover:underline">CoModel</a>.  It was originally built to support System Dynamics but is being extended to other forms of modeling and simulation through the <a href="https://www.buffalo.edu/ai-data-science/research/beams.html" className="text-blue-600 hover:underline">BEAMS</a> Initiative.
          </p>
          <p className="text-xl sm:text-2xl text-gray-600 max-w-4xl mx-auto mb-12 leading-relaxed"> 
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
                  className="inline-block px-6 py-3 bg-blue-600 text-white no-underline rounded-lg text-base font-semibold border-none cursor-pointer hover:bg-blue-700"
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
                  className="inline-block px-6 py-3 bg-green-600 text-white no-underline rounded-lg text-base font-semibold border-none cursor-pointer hover:bg-green-700"
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
              <span>Provide a hub for state of the art AI tools (<Link to="/engines" className="text-blue-600 hover:underline">engines</Link>) and benchmarks (<Link to="/evals" className="text-blue-600 hover:underline">evals</Link>) for dynamic modeling</span>
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
              <span>Create standardized data formats that allow rapid integration of AI tools into current modeling tools and projects</span>
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
          <div className="flex items-center justify-center min-h-[80px]">
            <a href="https://www.buffalo.edu/ai-data-science.html" target="_blank" rel="noopener noreferrer" aria-label="University at Buffalo">
              <img 
                src="https://www.buffalo.edu/v-fea3d69c5514d109f47d42a0d9913643/etc.clientlibs/wci/components/block/header/clientlibs/resources/ub-logo-blue-stacked-group.svg" 
                alt="University at Buffalo logo" 
                className="h-12 sm:h-16 object-contain mx-auto"
                style={{ maxWidth: '120px' }}
              />
            </a>
          </div>
          <div className="flex items-center justify-center min-h-[80px]">
            <a href="https://www.iseesystems.com" target="_blank" rel="noopener noreferrer" aria-label="isee systems">
              <img
                src="https://iseesystems.com/images/logos/isee-side.svg"
                alt="isee systems logo"
                className="h-10 sm:h-14 object-contain mx-auto"
                style={{ maxWidth: '120px' }}
              />
            </a>
          </div>
          <div className="flex items-center justify-center min-h-[80px]">
            <a href="https://skipdesigned.com/" target="_blank" rel="noopener noreferrer" aria-label="Skip Designed">
              <span className="flex flex-col items-center gap-1" style={{ width: '70px' }}>
                <svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 153.5 185.2" style={{ width: '100%', height: '60px' }} xmlSpace="preserve">
                  <defs>
                    <linearGradient id="SVGID_1_" gradientUnits="userSpaceOnUse" x1="0" y1="92.6076" x2="153.5396" y2="92.6076">
                      <stop offset="0.001221955" stopColor="#EB008B" />
                      <stop offset="1" stopColor="#262261" />
                    </linearGradient>
                  </defs>
                  <path className="st0" fill="url(#SVGID_1_)" d="M152.6,127.9L152.4,3c0.7-0.2,1.1-0.8,1.1-1.5c0-0.8-0.7-1.5-1.5-1.5c-0.8,0-1.5,0.7-1.5,1.5c0,0,0,0.1,0,0.1 l-40.4,27.5c-0.2-0.1-0.4-0.2-0.6-0.2c-0.6,0-1,0.5-1,1c0,0.4,0.3,0.8,0.7,1v16.5c-0.1,0-0.1,0-0.2,0.1l-18.9-29 c0.2-0.2,0.3-0.5,0.3-0.7c0-0.7-0.6-1.3-1.3-1.3c-0.5,0-1,0.3-1.2,0.8l-4.9,0c-0.1-0.1-0.2-0.1-0.3-0.1c-0.2,0-0.4,0.2-0.5,0.4 L41,51.8c-0.2-0.2-0.5-0.3-0.8-0.3c-0.8,0-1.4,0.6-1.4,1.4c0,0.6,0.3,1.1,0.8,1.3l0,32.6c-1.2,0.2-2.1,1.2-2.1,2.4 c0,0.4,0.1,0.8,0.3,1.2L1,131.2c-0.1,0-0.1,0-0.2,0c-0.5,0-0.8,0.4-0.8,0.8c0,0.5,0.4,0.8,0.8,0.8c0,0,0,0,0.1,0l32,50.4 c-0.2,0.2-0.3,0.5-0.3,0.8c0,0.7,0.5,1.2,1.2,1.2c0.5,0,0.9-0.3,1.1-0.8l4.1,0c0.2,0.4,0.5,0.7,1,0.7c0.6,0,1.1-0.5,1.1-1.1 c0-0.2,0-0.3-0.1-0.4l41.6-42c0.1,0,0.1,0,0.2,0c0.5,0,0.9-0.4,0.9-0.9c0-0.3-0.2-0.6-0.5-0.8v-7c0.1,0,0.1,0,0.2-0.1l20.2,26.4 c-0.1,0.1-0.1,0.3-0.1,0.4c0,0.6,0.5,1,1,1c0.4,0,0.8-0.3,1-0.6l2.8,0c0.1,0.6,0.7,1,1.3,1c0.7,0,1.3-0.6,1.3-1.3 c0-0.2,0-0.3-0.1-0.5l40.9-29.5c0.2,0.1,0.4,0.2,0.6,0.2c0.6,0,1.1-0.5,1.1-1.1C153.3,128.4,153,128.1,152.6,127.9z M39,183.7 l-4.1,0c-0.2-0.5-0.6-0.8-1.1-0.8c0,0-0.1,0-0.1,0L4.3,136.8l35,46.5C39.1,183.3,39,183.5,39,183.7z M39.4,183.1l-36.1-48l-1.7-2.7 c0.1-0.1,0.1-0.3,0.1-0.4c0-0.1,0-0.2-0.1-0.3l36.7-40.7c0.3,0.3,0.8,0.5,1.3,0.6l0,91.4C39.5,183.1,39.5,183.1,39.4,183.1z  M40.4,54.4c0.1,0,0.2,0,0.2,0l41.4,76c-0.1,0-0.1,0.1-0.2,0.1L41.9,90.7c0.3-0.4,0.5-0.9,0.5-1.5c0-1.2-0.9-2.2-2.1-2.4L40.4,54.4z  M81.9,141.1L40.4,183c0,0,0,0-0.1,0l0-91.4c0.5-0.1,1-0.3,1.3-0.7l40.4,49.1c-0.2,0.2-0.3,0.4-0.3,0.6 C81.9,140.9,81.9,141,81.9,141.1z M82.4,140c0,0-0.1,0-0.1,0.1L41.8,90.9c0,0,0,0,0,0l39.9,39.8c-0.2,0.3-0.4,0.6-0.4,1 c0,0.6,0.4,1.2,1,1.3V140z M82.4,130.2c-0.1,0-0.2,0-0.3,0.1l-41.4-76c0.5-0.2,0.9-0.7,0.9-1.3c0-0.2,0-0.4-0.1-0.6l40.9-34V130.2z  M87.9,18c0.1,0.6,0.6,1,1.2,1c0.1,0,0.3,0,0.4-0.1l18.9,29c0,0,0,0-0.1,0.1L83.2,18L87.9,18z M108.2,159.3l-2.8,0 c-0.2-0.4-0.5-0.6-1-0.6c-0.1,0-0.2,0-0.3,0.1l-18.6-24.3l23.4,24.1C108.5,158.7,108.3,159,108.2,159.3z M109,158.5l-24.3-25.1 l-0.8-1c0.2-0.2,0.2-0.5,0.2-0.8c0-0.7-0.5-1.2-1.1-1.4V18.1l25.1,30c-0.2,0.3-0.3,0.6-0.3,0.9c0,0.7,0.5,1.4,1.2,1.6L109,158.5 C109,158.5,109,158.5,109,158.5z M110,31.2l41.5,96.1l-41.3-76.8c0.6-0.2,1-0.8,1-1.5c0-0.8-0.5-1.4-1.2-1.6V31.2z M151.1,128.9 c0,0.1,0,0.2,0,0.3l-40.9,29.5c-0.1-0.1-0.3-0.1-0.4-0.2l0-107.9c0.1,0,0.1,0,0.2,0l41.6,77.4C151.3,128.2,151.1,128.5,151.1,128.9z  M110,30.9c0.4-0.2,0.6-0.5,0.6-0.9c0-0.1,0-0.1,0-0.2l40.2-27.4c0.2,0.3,0.5,0.5,0.9,0.6l0.2,124.8L110,30.9z" />
                </svg>
                <span className="text-center w-full" style={{width: 150, color: "#545255"}}>SKIP DESIGNED</span>
              </span>
            </a>
          </div>
          <div className="flex items-center justify-center min-h-[80px]">
            <a href="https://systemdynamics.org/" target="_blank" rel="noopener noreferrer" aria-label="System Dynamics Society">
              <img
                src="https://b2104009.smushcdn.com/2104009/wp-content/uploads/2023/04/logo-vertical-web-01-1.png?lossy=2&strip=1&avif=1"
                alt="System Dynamics Society logo"
                className="h-14 sm:h-20 object-contain mx-auto"
              />
            </a>
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
            Join our diverse community of academics, industry experts, and software vendors shaping the future of AI-powered modeling.
          </p>
          <Link 
            to="/get-involved"
            className="inline-block px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white no-underline rounded-lg text-lg font-semibold border-none cursor-pointer hover:from-blue-700 hover:to-purple-700 shadow-lg hover:shadow-xl"
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
