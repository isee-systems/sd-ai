import { Link } from 'react-router-dom';

function GetInvolved() {
  return (
    <div className="get-involved-page py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-800 mb-6">
            Get Involved
          </h1>
          <p className="text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            We're a diverse community of academics, industry experts, software vendors and individuals interested in guiding the development of the next generation of software for the field. Join us!
          </p>
        </div>

        <div className="bg-gradient-to-r from-blue-50 to-green-50 p-8 sm:p-10 rounded-xl">
          {/* Introduction Card */}
          <div className="bg-white p-8 rounded-lg shadow-sm mb-10">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">
              Start Experimenting!
            </h2>
            <p className="text-gray-600 leading-relaxed mb-6 text-lg">
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
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 sm:gap-10">
            <div className="space-y-8">
              <div className="bg-white p-8 rounded-lg shadow-sm">
                <h3 className="text-xl font-bold mb-6 text-gray-800">
                  Join the Community 
                </h3>
                <ul className="space-y-4 text-gray-600">
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-3 mt-1 text-lg">•</span>
                    <span className="leading-relaxed">
                      Join the{' '}
                      <a 
                        href="https://groups.io/g/sd-ai/" 
                        className="text-blue-600 hover:underline font-medium"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        sd-ai groups.io
                      </a>
                      {' '}mailing list to join the discussion on the evolution of this project
                    </span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-3 mt-1 text-lg">•</span>
                    <span className="leading-relaxed">We'd love to hear your ideas for new types of engines, engine implementations, or evaluations</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-3 mt-1 text-lg">•</span>
                    <span className="leading-relaxed">
                      Join regular Zoom meetings hosted by{' '}
                      <a 
                        href="https://www.buffalo.edu/ai-data-science/research/beams.html" 
                        className="text-blue-600 hover:underline font-medium"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        BEAMS
                      </a>
                    </span>
                  </li>
                </ul>
              </div>
            </div>
            
            <div className="space-y-8">
              <div className="bg-white p-8 rounded-lg shadow-sm">
                <h3 className="text-xl font-bold mb-6 text-gray-800">
                  Developers & Product Owners
                </h3>
                <ul className="space-y-4 text-gray-600">
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-3 mt-1 text-lg">•</span>
                    <span className="leading-relaxed">
                      Contribute code on our{' '}
                      <a 
                        href="https://github.com/UB-IAD/sd-ai"
                        className="text-blue-600 hover:underline font-medium"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        GitHub repository
                      </a>
                    </span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-3 mt-1 text-lg">•</span>
                    <span className="leading-relaxed">Help refine existing engines or contribute new AI engines</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-3 mt-1 text-lg">•</span>
                    <span className="leading-relaxed">
                      Improve evaluations used to measure model performance
                    </span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-3 mt-1 text-lg">•</span>
                    <span className="leading-relaxed">Integrate SD-AI into your application with our simple API</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default GetInvolved;
