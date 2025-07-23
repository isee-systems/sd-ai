import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';

function Layout({ children }) {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navigationItems = [
    { path: '/', label: 'Home' },
    { path: '/engines', label: 'Engines', hasSubPages: true },
    { path: '/evals', label: 'Evaluations', hasSubPages: true },
    { 
      path: '/get-involved', 
      label: 'Get Involved',
      special: true // for gradient styling
    }
  ];

  const isActive = (path, hasSubPages = false) => {
    // Handle exact matches first
    if (location.pathname === path) {
      return true;
    }
    
    // Handle sub-routes for sections that have them
    if (hasSubPages && location.pathname.startsWith(`${path}/`)) {
      return true;
    }
    
    return false;
  };

  const getNavLinkClasses = (item, isMobile = false) => {
    const padding = isMobile ? 'px-6 py-4' : 'px-4 py-2';
    const baseClasses = `no-underline ${padding} rounded-md font-medium`;
    
    if (isMobile) {
      // Mobile-specific styling for dropdown
      const mobileBase = `no-underline ${padding} font-medium border-b border-gray-700 last:border-b-0 hover:bg-gray-800 transition-colors`;
      
      if (item.special) {
        return `${mobileBase} ${
          isActive(item.path, item.hasSubPages) 
            ? 'text-white bg-gradient-to-r from-purple-600 to-blue-600' 
            : 'text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700'
        }`;
      }
      
      return `${mobileBase} ${
        isActive(item.path, item.hasSubPages) 
          ? 'text-white bg-gray-800' 
          : 'text-gray-300 hover:text-white'
      }`;
    }
    
    if (item.special) {
      return `${baseClasses} bg-gradient-to-r from-purple-600 to-blue-600 shadow-lg ${
        isActive(item.path, item.hasSubPages) 
          ? 'text-white shadow-xl' 
          : 'text-white hover:shadow-xl hover:from-purple-700 hover:to-blue-700'
      }`;
    }
    
    return `${baseClasses} ${
      isActive(item.path, item.hasSubPages) 
        ? 'text-white bg-gray-700' 
        : 'text-gray-300 hover:text-white hover:bg-gray-700'
    }`;
  };

  const NavLink = ({ item, isMobile = false }) => (
    <Link
      to={item.path}
      className={getNavLinkClasses(item, isMobile)}
      onClick={isMobile ? () => setIsMobileMenuOpen(false) : undefined}
    >
      {item.label}
    </Link>
  );

  return (
    <div className="layout">
      {/* Navigation Header */}
      <header className="bg-gray-900 px-5 border-b border-gray-700 relative">
        <nav className="flex items-center justify-between max-w-6xl mx-auto h-16">
          {/* Logo/Brand */}
          <Link 
            to="/" 
            className="text-white no-underline text-2xl font-bold flex items-center hover:text-blue-300"
          >
            SD-AI
          </Link>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex gap-1">
            {navigationItems.map((item) => (
              <NavLink key={item.path} item={item} />
            ))}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden text-gray-300 p-2 rounded-md hover:text-white hover:bg-gray-700"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle mobile menu"
          >
            <div className="w-6 h-6 flex flex-col justify-around">
              <span className="block h-0.5 w-6 bg-current"></span>
              <span className="block h-0.5 w-6 bg-current"></span>
              <span className="block h-0.5 w-6 bg-current"></span>
            </div>
          </button>
        </nav>

        {/* Mobile Menu */}
        <div className={`md:hidden ${isMobileMenuOpen ? 'block' : 'hidden'}`}>
          <nav className="absolute top-full left-0 right-0 bg-gray-900 shadow-lg border-t border-gray-700 z-50">
            <div className="flex flex-col py-2">
              {navigationItems.map((item) => (
                <NavLink key={item.path} item={item} isMobile={true} />
              ))}
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
