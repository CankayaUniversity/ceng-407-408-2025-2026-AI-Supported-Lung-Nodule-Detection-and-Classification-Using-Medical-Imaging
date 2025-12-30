import { useState, useEffect } from 'react';
import { LogOut, BarChart3, Users, FileText, Clock, Activity, UserCheck, Stethoscope } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './AdminDashboard.css';

const API_URL = 'http://localhost:3001/api';

function AdminDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalUsers: 0,
    doctorCount: 0,
    adminCount: 0,
    totalPatients: 0,
    totalStudies: 0,
    completedStudies: 0,
    pendingStudies: 0,
    last24hLogins: 0
  });
  const [recentActivities, setRecentActivities] = useState([]);
  
  // Get user info from localStorage
  const userName = localStorage.getItem('username') || 'Admin';
  const userFirstName = userName.split(' ')[0];

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // Fetch dashboard stats
      const statsResponse = await fetch(`${API_URL}/stats/dashboard`);
      const statsData = await statsResponse.json();
      setStats(statsData);

      // Fetch recent activities
      const activitiesResponse = await fetch(`${API_URL}/activity-logs?limit=10`);
      const activitiesData = await activitiesResponse.json();
      
      const formattedActivities = activitiesData.map(log => ({
        id: log.id,
        date: new Date(log.created_at).toLocaleString('en-US'),
        user: log.username,
        action: log.action,
        type: log.action_type
      }));
      
      setRecentActivities(formattedActivities);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    // Log logout activity
    try {
      await fetch(`${API_URL}/activity-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: parseInt(localStorage.getItem('userId')),
          username: localStorage.getItem('username'),
          action: 'Logged out of system',
          action_type: 'logout'
        })
      });
    } catch (error) {
      console.error('Error logging logout:', error);
    }
    
    localStorage.removeItem('userType');
    localStorage.removeItem('username');
    localStorage.removeItem('userId');
    localStorage.removeItem('userEmail');
    navigate('/login');
  };

  const getActionTypeIcon = (type) => {
    switch (type) {
      case 'login': return '[L]';
      case 'logout': return '[O]';
      case 'user': return '[U]';
      case 'study': return '[S]';
      case 'report': return '[R]';
      default: return '[*]';
    }
  };

  const statsCards = [
    { label: 'Total Users', value: stats.totalUsers, icon: Users, color: '#3b82f6' },
    { label: 'Doctors', value: stats.doctorCount, icon: Stethoscope, color: '#10b981' },
    { label: 'Total Patients', value: stats.totalPatients, icon: UserCheck, color: '#8b5cf6' },
    { label: 'Last 24h Logins', value: stats.last24hLogins, icon: Activity, color: '#f59e0b' },
  ];

  if (loading) {
    return (
      <div className="admin-container">
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div className="header-left">
          <h1>Admin Dashboard</h1>
          <p>System Management & Monitoring</p>
        </div>
        <div className="header-right">
          <span className="user-info">Welcome, {userFirstName}</span>
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </div>

      <div className="admin-content">
        {/* Stats Cards */}
        <div className="stats-grid">
          {statsCards.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <div key={index} className="stat-card">
                <div className="stat-icon" style={{ background: `${stat.color}20`, color: stat.color }}>
                  <Icon size={24} />
                </div>
                <div className="stat-info">
                  <div className="stat-value">{stat.value}</div>
                  <div className="stat-label">{stat.label}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Secondary Stats */}
        <div className="secondary-stats">
          <div className="secondary-stat-card">
            <h3>Study Status</h3>
            <div className="stat-row">
              <span>Total Studies:</span>
              <strong>{stats.totalStudies}</strong>
            </div>
            <div className="stat-row">
              <span>Completed:</span>
              <strong style={{ color: '#10b981' }}>{stats.completedStudies}</strong>
            </div>
            <div className="stat-row">
              <span>Pending:</span>
              <strong style={{ color: '#f59e0b' }}>{stats.pendingStudies}</strong>
            </div>
          </div>
          <div className="secondary-stat-card">
            <h3>User Distribution</h3>
            <div className="stat-row">
              <span>Admin:</span>
              <strong>{stats.adminCount}</strong>
            </div>
            <div className="stat-row">
              <span>Doctor:</span>
              <strong>{stats.doctorCount}</strong>
            </div>
            <div className="stat-row">
              <span>Total:</span>
              <strong>{stats.totalUsers}</strong>
            </div>
          </div>
        </div>

        {/* Recent Activities */}
        <div className="recent-activities">
          <h2>Recent Activities</h2>
          {recentActivities.length === 0 ? (
            <p className="no-activities">No activity records yet</p>
          ) : (
            <div className="activities-list">
              {recentActivities.map((activity) => (
                <div key={activity.id} className="activity-item">
                  <div className="activity-icon">{getActionTypeIcon(activity.type)}</div>
                  <div className="activity-time">
                    <Clock size={14} />
                    {activity.date}
                  </div>
                  <div className="activity-user">{activity.user}</div>
                  <div className="activity-action">{activity.action}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="quick-actions">
          <div className="action-card" onClick={() => navigate('/admin/users')}>
            <Users size={24} />
            <h3>User Management</h3>
            <p>Manage users</p>
          </div>
          <div className="action-card" onClick={() => navigate('/admin/settings')}>
            <BarChart3 size={24} />
            <h3>System Settings</h3>
            <p>Configure settings</p>
          </div>
          <div className="action-card" onClick={() => navigate('/admin/logs')}>
            <FileText size={24} />
            <h3>Activity Logs</h3>
            <p>View activities</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
