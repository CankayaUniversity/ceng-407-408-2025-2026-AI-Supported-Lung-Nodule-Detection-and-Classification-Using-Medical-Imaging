import { useState } from 'react';
import { LogOut, BarChart3, Users, FileText, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './AdminDashboard.css';

function AdminDashboard() {
  const navigate = useNavigate();
  const username = localStorage.getItem('username') || 'Admin';

  const handleLogout = () => {
    localStorage.removeItem('userType');
    localStorage.removeItem('username');
    navigate('/login');
  };

  const stats = [
    { label: 'Toplam Kullanıcı', value: '24', icon: Users },
    { label: 'Doktor Sayısı', value: '18', icon: FileText },
    { label: 'Son 24s Giriş', value: '12', icon: BarChart3 },
    { label: 'Aktif Sistem', value: '100%', icon: Clock },
  ];

  const recentActivities = [
    { date: '23.12.2025 14:32', user: 'dr.ayşe', action: 'Yeni çalışma ekledi', type: 'study' },
    { date: '23.12.2025 13:15', user: 'dr.mehmet', action: 'Rapor oluşturdu', type: 'report' },
    { date: '23.12.2025 11:42', user: 'admin', action: 'Yeni kullanıcı ekledi: dr.fatih', type: 'user' },
    { date: '23.12.2025 10:20', user: 'dr.fatih', action: 'Sistem ayarlarını güncelledi', type: 'settings' },
    { date: '22.12.2025 16:55', user: 'dr.ayşe', action: 'İnceleme tamamlandı', type: 'study' },
  ];

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div className="header-left">
          <h1>Admin Dashboard</h1>
          <p>Sistem Yönetimi ve İzleme</p>
        </div>
        <div className="header-right">
          <span className="user-info">Hoşgeldiniz, {username}</span>
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={18} />
            Çıkış
          </button>
        </div>
      </div>

      <div className="admin-content">
        {/* Stats Cards */}
        <div className="stats-grid">
          {stats.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <div key={index} className="stat-card">
                <div className="stat-icon">
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

        {/* Recent Activities */}
        <div className="recent-activities">
          <h2>Son İşlemler</h2>
          <div className="activities-list">
            {recentActivities.map((activity, index) => (
              <div key={index} className="activity-item">
                <div className="activity-time">
                  <Clock size={16} />
                  {activity.date}
                </div>
                <div className="activity-user">{activity.user}</div>
                <div className="activity-action">{activity.action}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="quick-actions">
          <div className="action-card" onClick={() => navigate('/admin/users')}>
            <Users size={24} />
            <h3>Kullanıcı Yönetimi</h3>
            <p>Kullanıcıları yönet</p>
          </div>
          <div className="action-card" onClick={() => navigate('/admin/settings')}>
            <BarChart3 size={24} />
            <h3>Sistem Ayarları</h3>
            <p>Ayarları yapılandır</p>
          </div>
          <div className="action-card" onClick={() => navigate('/admin/logs')}>
            <FileText size={24} />
            <h3>İşlem Kayıtları</h3>
            <p>İşlemleri görüntüle</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
