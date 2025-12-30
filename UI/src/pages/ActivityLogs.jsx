import { useState, useEffect } from 'react';
import { LogOut, Calendar, User, Filter, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './ActivityLogs.css';

const API_URL = 'http://localhost:3001/api';

function ActivityLogs() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    user: 'all',
    actionType: 'all',
  });

  const [showFilters, setShowFilters] = useState(false);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/activity-logs?limit=100`);
      const data = await response.json();
      
      const formattedLogs = data.map(log => ({
        id: log.id,
        date: new Date(log.created_at).toLocaleDateString('en-US'),
        time: new Date(log.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        user: log.username,
        role: log.action_type === 'login' || log.action_type === 'logout' ? 'User' : 'System',
        action: log.action,
        actionType: log.action_type
      }));
      
      setLogs(formattedLogs);
    } catch (error) {
      console.error('Error fetching logs:', error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('userType');
    localStorage.removeItem('username');
    navigate('/login');
  };

  const getUniqueUsers = () => {
    return [...new Set(logs.map(log => log.user))];
  };

  const filteredLogs = logs.filter(log => {
    if (filters.user !== 'all' && log.user !== filters.user) return false;
    if (filters.actionType !== 'all' && log.actionType !== filters.actionType) return false;
    return true;
  });

  return (
    <div className="activity-logs">
      <div className="al-header">
        <div>
          <h1>Activity Logs</h1>
          <p>System activity and transaction history</p>
        </div>
        <div className="header-actions">
          <button className="back-btn" onClick={() => navigate('/admin')}>
            <ArrowLeft size={18} />
            Go Back
          </button>
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </div>

      <div className="al-content">
        {/* Filter Toggle Button */}
        <div className="filter-toggle">
          <button 
            className="btn-filter-toggle"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={18} />
            Filters
          </button>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="filters-panel">
            <div className="filter-group">
              <label>Start Date</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              />
            </div>

            <div className="filter-group">
              <label>End Date</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              />
            </div>

            <div className="filter-group">
              <label>User</label>
              <select
                value={filters.user}
                onChange={(e) => setFilters({ ...filters, user: e.target.value })}
              >
                <option value="all">All Users</option>
                {getUniqueUsers().map(user => (
                  <option key={user} value={user}>{user}</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label>Action Type</label>
              <select
                value={filters.actionType}
                onChange={(e) => setFilters({ ...filters, actionType: e.target.value })}
              >
                <option value="all">All Actions</option>
                <option value="login">Login</option>
                <option value="logout">Logout</option>
                <option value="user">User Actions</option>
                <option value="study">Study Actions</option>
              </select>
            </div>
          </div>
        )}

        {/* Logs Table */}
        <div className="table-wrapper">
          {loading ? (
            <p style={{ textAlign: 'center', padding: '40px' }}>Loading...</p>
          ) : filteredLogs.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '40px' }}>No activity records yet</p>
          ) : (
          <table className="logs-table">
            <thead>
              <tr>
                <th>Date-Time</th>
                <th>User</th>
                <th>Action Type</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td className="log-datetime">
                    <Calendar size={16} />
                    <span>{log.date} {log.time}</span>
                  </td>
                  <td className="log-user">
                    <User size={16} />
                    <span>{log.user}</span>
                  </td>
                  <td>
                    <span className={`action-type-badge ${log.actionType}`}>
                      {log.actionType === 'login' ? 'Login' : 
                       log.actionType === 'logout' ? 'Logout' :
                       log.actionType === 'user' ? 'User' :
                       log.actionType === 'study' ? 'Study' : 'Other'}
                    </span>
                  </td>
                  <td className="log-action">{log.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default ActivityLogs;
