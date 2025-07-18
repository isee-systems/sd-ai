import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';

function Layout({ children }) {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isActive = (path) => {
    if (path === '/engines') {
      return location.pathname === '/engines' || location.pathname.startsWith('/engines/');
    }
    return location.pathname === path;
  };

  return (
    <div className="layout">
      {/* Navigation Header */}
      <header className="bg-slate-700 px-5 border-b-4 border-slate-600">
        <nav className="flex items-center justify-between max-w-6xl mx-auto h-16">
          {/* Logo/Brand */}
          <Link 
            to="/" 
            className="text-white no-underline text-2xl font-bold flex items-center"
          >
            SD-AI
          </Link>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex gap-8">
            <Link
              to="/"
              className={`no-underline px-4 py-2 rounded transition-all duration-200 ${
                isActive('/') 
                  ? 'text-blue-400 font-bold bg-blue-900 bg-opacity-20' 
                  : 'text-white font-normal hover:bg-white hover:bg-opacity-10'
              }`}
            >
              Home
            </Link>
            
            <Link
              to="/engines"
              className={`no-underline px-4 py-2 rounded transition-all duration-200 ${
                isActive('/engines') 
                  ? 'text-blue-400 font-bold bg-blue-900 bg-opacity-20' 
                  : 'text-white font-normal hover:bg-white hover:bg-opacity-10'
              }`}
            >
              Engines
            </Link>
            
            <Link
              to="/evals"
              className={`no-underline px-4 py-2 rounded transition-all duration-200 ${
                isActive('/evals') 
                  ? 'text-blue-400 font-bold bg-blue-900 bg-opacity-20' 
                  : 'text-white font-normal hover:bg-white hover:bg-opacity-10'
              }`}
            >
              Evaluations
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden text-white p-2 rounded hover:bg-white hover:bg-opacity-10 transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle mobile menu"
          >
            <div className="w-6 h-6 flex flex-col justify-around">
              <span className={`block h-0.5 w-6 bg-white transition-all duration-300 ${isMobileMenuOpen ? 'rotate-45 translate-y-2' : ''}`}></span>
              <span className={`block h-0.5 w-6 bg-white transition-all duration-300 ${isMobileMenuOpen ? 'opacity-0' : ''}`}></span>
              <span className={`block h-0.5 w-6 bg-white transition-all duration-300 ${isMobileMenuOpen ? '-rotate-45 -translate-y-2' : ''}`}></span>
            </div>
          </button>
        </nav>

        {/* Mobile Menu */}
        <div className={`md:hidden overflow-hidden transition-all duration-300 ${isMobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
          <nav className="bg-slate-700 border-t border-slate-600 px-5 py-4">
            <div className="flex flex-col gap-2">
              <Link
                to="/"
                className={`no-underline px-4 py-3 rounded transition-all duration-200 ${
                  isActive('/') 
                    ? 'text-blue-400 font-bold bg-blue-900 bg-opacity-20' 
                    : 'text-white font-normal hover:bg-white hover:bg-opacity-10'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Home
              </Link>
              
              <Link
                to="/engines"
                className={`no-underline px-4 py-3 rounded transition-all duration-200 ${
                  isActive('/engines') 
                    ? 'text-blue-400 font-bold bg-blue-900 bg-opacity-20' 
                    : 'text-white font-normal hover:bg-white hover:bg-opacity-10'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Engines
              </Link>
              
              <Link
                to="/evals"
                className={`no-underline px-4 py-3 rounded transition-all duration-200 ${
                  isActive('/evals') 
                    ? 'text-blue-400 font-bold bg-blue-900 bg-opacity-20' 
                    : 'text-white font-normal hover:bg-white hover:bg-opacity-10'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Evaluations
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
