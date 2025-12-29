import { useState } from 'react';
import {
  LayoutDashboard,
  FileText,
  Folder,
  PlusSquare,
  Archive,
  FileText as FileDoc,
  User,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import SidebarItem from './SidebarItem';
import './Sidebar.css';

function Sidebar({ isCollapsed }) {
  const location = useLocation();

  const menuItems = [
    {
      id: 'worklist',
      icon: FileText,
      label: 'Worklist',
      href: '/worklist',
    },
    {
      id: 'newstudy',
      icon: PlusSquare,
      label: 'New Study',
      href: '/new-study',
    },
    {
      id: 'past',
      icon: Archive,
      label: 'Past Studies',
      href: '/past-studies',
    },
    {
      id: 'reports',
      icon: FileDoc,
      label: 'My Reports',
      href: '/my-reports',
    },
    {
      id: 'profile',
      icon: User,
      label: 'Account',
      href: '/profile',
    },
  ];

  return (
    <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <nav className="sidebar-nav">
        {menuItems.map((item) => (
          <SidebarItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            href={item.href}
            isCollapsed={isCollapsed}
            subitems={item.subitems}
          />
        ))}
      </nav>
    </aside>
  );
}

export default Sidebar;
