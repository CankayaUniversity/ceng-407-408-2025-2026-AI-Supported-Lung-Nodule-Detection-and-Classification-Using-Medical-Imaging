import { Menu, LogOut, User } from 'lucide-react';
import './Topbar.css';

function Topbar({ onToggleSidebar, isSidebarCollapsed }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Menu size={24} />
        </button>
        <h1 className="topbar-title">LungXAI – Doctor Panel</h1>
      </div>

      <div className="topbar-right">
        <div className="user-menu">
          <User size={20} className="user-icon" />
          <span className="username">Dr. Smith</span>
        </div>
        <button className="logout-btn" aria-label="Logout" title="Logout">
          <LogOut size={20} />
        </button>
      </div>
    </header>
  );
}

export default Topbar;
