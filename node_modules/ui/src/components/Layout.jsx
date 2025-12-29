import Sidebar from './Sidebar';
import Topbar from './Topbar';
import './Layout.css';
import { useState } from 'react';

function Layout({ children }) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  return (
    <div className="layout">
      <Topbar
        onToggleSidebar={handleToggleSidebar}
        isSidebarCollapsed={isSidebarCollapsed}
      />
      <div className="layout-container">
        <Sidebar isCollapsed={isSidebarCollapsed} />
        <main className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}

export default Layout;
