import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import './SidebarItem.css';

function SidebarItem({ icon: Icon, label, isCollapsed, subitems = [], href }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const location = useLocation();

  const isActive = href && location.pathname === href;
  const hasSubitems = subitems.length > 0;

  const handleToggle = (e) => {
    if (hasSubitems) {
      e.preventDefault();
      setIsExpanded(!isExpanded);
    }
  };

  const itemContent = (
    <div className={`sidebar-item ${isActive ? 'active' : ''}`}>
      <div className="item-main" onClick={handleToggle}>
        <Icon size={20} className="item-icon" />
        {!isCollapsed && <span className="item-label">{label}</span>}
        {!isCollapsed && hasSubitems && (
          <ChevronDown
            size={16}
            className={`chevron ${isExpanded ? 'expanded' : ''}`}
          />
        )}
      </div>
    </div>
  );

  if (href && !hasSubitems) {
    return <Link to={href} className="sidebar-item-link">{itemContent}</Link>;
  }

  return (
    <div className="sidebar-item-wrapper">
      {hasSubitems ? (
        <button
          className="sidebar-item-button"
          onClick={handleToggle}
          aria-expanded={isExpanded}
        >
          {itemContent}
        </button>
      ) : (
        itemContent
      )}

      {!isCollapsed && hasSubitems && isExpanded && (
        <div className="submenu">
          {subitems.map((subitem) => (
            <Link
              key={subitem.href}
              to={subitem.href}
              className={`submenu-item ${
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

export default SidebarItem;
