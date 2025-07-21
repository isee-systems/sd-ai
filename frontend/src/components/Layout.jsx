import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';

function Layout({ children }) {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isActive = (path) => {
    if (path === '/engines') {
      return location.pathname === '/engines' || location.pathname.startsWith('/engines/');
    }
    if (path === '/get-involved') {
      return location.pathname === '/get-involved';
    }
    return location.pathname === path;
  };

  return (
    <div className="layout">
      {/* Navigation Header */}
      <header className="bg-gray-900 px-5 border-b border-gray-700">
        <nav className="flex items-center justify-between max-w-6xl mx-auto h-16">
          {/* Logo/Brand */}
          <Link 
            to="/" 
            className="text-white no-underline text-2xl font-bold flex items-center hover:text-blue-300 transition-colors"
          >
            SD-AI
          </Link>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex gap-1">
            <Link
              to="/"
              className={`no-underline px-4 py-2 rounded-md transition-all duration-200 font-medium ${
                isActive('/') 
                  ? 'text-white bg-gray-700' 
                  : 'text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              Home
            </Link>
            
            <Link
              to="/engines"
              className={`no-underline px-4 py-2 rounded-md transition-all duration-200 font-medium ${
                isActive('/engines') 
                  ? 'text-white bg-gray-700' 
                  : 'text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              Engines
            </Link>
            
            <Link
              to="/evals"
              className={`no-underline px-4 py-2 rounded-md transition-all duration-200 font-medium ${
                isActive('/evals') 
                  ? 'text-white bg-gray-700' 
                  : 'text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              Evaluations
            </Link>
            
            <Link
              to="/get-involved"
              className={`no-underline px-4 py-2 rounded-md transition-all duration-200 font-medium bg-gradient-to-r from-purple-600 to-blue-600 shadow-lg ${
                isActive('/get-involved') 
                  ? 'text-white shadow-xl' 
                  : 'text-white hover:shadow-xl hover:from-purple-700 hover:to-blue-700'
              }`}
            >
              Get Involved
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden text-gray-300 p-2 rounded-md hover:text-white hover:bg-gray-700 transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle mobile menu"
          >
            <div className="w-6 h-6 flex flex-col justify-around">
              <span className={`block h-0.5 w-6 bg-current transition-all duration-300 ${isMobileMenuOpen ? 'rotate-45 translate-y-2' : ''}`}></span>
              <span className={`block h-0.5 w-6 bg-current transition-all duration-300 ${isMobileMenuOpen ? 'opacity-0' : ''}`}></span>
              <span className={`block h-0.5 w-6 bg-current transition-all duration-300 ${isMobileMenuOpen ? '-rotate-45 -translate-y-2' : ''}`}></span>
            </div>
          </button>
        </nav>

        {/* Mobile Menu */}
        <div className={`md:hidden overflow-hidden transition-all duration-300 ${isMobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
          <nav className="bg-gray-800 border-t border-gray-700 px-5 py-4">
            <div className="flex flex-col gap-1">
              <Link
                to="/"
                className={`no-underline px-4 py-3 rounded-md transition-all duration-200 font-medium ${
                  isActive('/') 
                    ? 'text-white bg-gray-700' 
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Home
              </Link>
              
              <Link
                to="/engines"
                className={`no-underline px-4 py-3 rounded-md transition-all duration-200 font-medium ${
                  isActive('/engines') 
                    ? 'text-white bg-gray-700' 
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Engines
              </Link>
              
              <Link
                to="/evals"
                className={`no-underline px-4 py-3 rounded-md transition-all duration-200 font-medium ${
                  isActive('/evals') 
                    ? 'text-white bg-gray-700' 
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Evaluations
              </Link>
              
              <Link
                to="/get-involved"
                className={`no-underline px-4 py-3 rounded-md transition-all duration-200 font-medium bg-gradient-to-r from-purple-600 to-blue-600 shadow-lg ${
                  isActive('/get-involved') 
                    ? 'text-white shadow-xl' 
                    : 'text-white hover:shadow-xl hover:from-purple-700 hover:to-blue-700'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Get Involved
              </Link>
            </div>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="min-h-screen">
        <div className="max-w-6xl mx-auto px-2 sm:px-4 lg:px-6">
          {children}
        </div>
      </main>
    </div>
  );
}

export default Layout;
