import { Menu, LogOut, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import './Topbar.css';

function Topbar({ onToggleSidebar, isSidebarCollapsed }) {
  const navigate = useNavigate();
  const [userName, setUserName] = useState('');

  useEffect(() => {
    const firstName = localStorage.getItem('userFirstName') || '';
    const lastName = localStorage.getItem('userLastName') || '';
    
    if (firstName || lastName) {
      setUserName(`Dr. ${firstName} ${lastName}`.trim());
    } else {
      const username = localStorage.getItem('username') || 'Doctor';
      setUserName(`Dr. ${username}`);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('userType');
    localStorage.removeItem('username');
    localStorage.removeItem('userFirstName');
    localStorage.removeItem('userLastName');
    localStorage.removeItem('userId');
    navigate('/login');
  };

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
          <span className="username">{userName}</span>
        </div>
        <button className="logout-btn" onClick={handleLogout} aria-label="Logout" title="Logout">
          <LogOut size={20} />
        </button>
      </div>
    </header>
  );
}

export default Topbar;
