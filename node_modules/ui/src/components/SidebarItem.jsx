import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';

function SidebarItem({ icon: Icon, label, href, isCollapsed, subitems }) {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  
  const isActive = href && location.pathname === href;
  const isSubitemActive = subitems && subitems.some(item => location.pathname === item.href);

  if (subitems) {
    return (
      <div className="sidebar-item-group">
        <button
          className={`sidebar-item-btn ${isSubitemActive ? 'active' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
          title={isCollapsed ? label : ''}
        >
          <Icon size={20} />
          {!isCollapsed && (
            <>
              <span>{label}</span>
              <ChevronDown 
                size={16} 
                className={`chevron ${isOpen ? 'open' : ''}`}
              />
            </>
          )}
        </button>
        {isOpen && !isCollapsed && (
          <div className="sidebar-subitems">
            {subitems.map((subitem) => (
              <Link
                key={subitem.href}
                to={subitem.href}
                className={`sidebar-subitem ${
                  location.pathname === subitem.href ? 'active' : ''
                }`}
              >
                {subitem.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      to={href}
      className={`sidebar-item ${isActive ? 'active' : ''}`}
      title={isCollapsed ? label : ''}
    >
      <Icon size={20} />
      {!isCollapsed && <span>{label}</span>}
    </Link>
  );
}

export default SidebarItem;
