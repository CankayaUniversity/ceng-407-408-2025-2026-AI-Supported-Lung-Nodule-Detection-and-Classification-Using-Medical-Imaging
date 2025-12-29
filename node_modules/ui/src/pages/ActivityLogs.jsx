import { useState } from 'react';
import { LogOut, Calendar, User, Filter, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './ActivityLogs.css';

function ActivityLogs() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    user: 'all',
    actionType: 'all',
  });

  const [showFilters, setShowFilters] = useState(false);

  const allLogs = [
    { id: 1, date: '23.12.2025', time: '15:42', user: 'dr.ayşe', role: 'Doctor', action: 'Hasta P-10234 inceleme ekranını açtı' },
    { id: 2, date: '23.12.2025', time: '14:32', user: 'dr.mehmet', role: 'Doctor', action: 'P-10233 hastası için rapor oluşturdu' },
    { id: 3, date: '23.12.2025', time: '13:15', user: 'admin', role: 'Admin', action: 'Yeni kullanıcı ekledi: Dr. Fatih Kaya' },
    { id: 4, date: '23.12.2025', time: '11:42', user: 'dr.fatih', role: 'Doctor', action: 'Sistem ayarlarını güncelledi' },
    { id: 5, date: '22.12.2025', time: '16:55', user: 'dr.ayşe', role: 'Doctor', action: 'P-10232 hastasının inceleme ekranını kapatıp tamamlandı işaretledi' },
    { id: 6, date: '22.12.2025', time: '15:20', user: 'admin', role: 'Admin', action: 'Dr. Mehmet kullanıcısının şifresini sıfırladı' },
    { id: 7, date: '22.12.2025', time: '14:05', user: 'dr.mehmet', role: 'Doctor', action: 'Yeni çalışma ekledi - Hasta: M.A., TC: 123456789' },
    { id: 8, date: '22.12.2025', time: '13:30', user: 'dr.fatih', role: 'Doctor', action: 'Kullanıcı profili güncellendi' },
    { id: 9, date: '21.12.2025', time: '16:10', user: 'admin', role: 'Admin', action: 'Dr. Ayşe kullanıcısını pasifleştirdi' },
    { id: 10, date: '21.12.2025', time: '15:45', user: 'dr.ayşe', role: 'Doctor', action: 'P-10231 hastasının tüm görüntülerini görüntüledi' },
  ];

  const [logs] = useState(allLogs);

  const handleLogout = () => {
    localStorage.removeItem('userType');
    localStorage.removeItem('username');
    navigate('/login');
  };

  const getUniqueUsers = () => {
    return [...new Set(logs.map(log => log.user))];
  };

  return (
    <div className="activity-logs">
      <div className="al-header">
        <div>
          <h1>İşlem Kayıtları</h1>
          <p>Sistem aktivitesi ve işlem geçmişi</p>
        </div>
        <div className="header-actions">
          <button className="back-btn" onClick={() => navigate('/admin')}>
            <ArrowLeft size={18} />
            Geri Dön
          </button>
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={18} />
            Çıkış
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
            Filtreler
          </button>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="filters-panel">
            <div className="filter-group">
              <label>Başlangıç Tarihi</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              />
            </div>

            <div className="filter-group">
              <label>Bitiş Tarihi</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              />
            </div>

            <div className="filter-group">
              <label>Kullanıcı</label>
              <select
                value={filters.user}
                onChange={(e) => setFilters({ ...filters, user: e.target.value })}
              >
                <option value="all">Tüm Kullanıcılar</option>
                {getUniqueUsers().map(user => (
                  <option key={user} value={user}>{user}</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label>İşlem Türü</label>
              <select
                value={filters.actionType}
                onChange={(e) => setFilters({ ...filters, actionType: e.target.value })}
              >
                <option value="all">Tüm İşlemler</option>
                <option value="login">Giriş</option>
                <option value="view">Görüntüleme</option>
                <option value="create">Oluşturma</option>
                <option value="report">Rapor</option>
              </select>
            </div>
          </div>
        )}

        {/* Logs Table */}
        <div className="table-wrapper">
          <table className="logs-table">
            <thead>
              <tr>
                <th>Tarih-Saat</th>
                <th>Kullanıcı</th>
                <th>Rol</th>
                <th>İşlem Açıklaması</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className={`role-${log.role.toLowerCase()}`}>
                  <td className="log-datetime">
                    <Calendar size={16} />
                    <span>{log.date} {log.time}</span>
                  </td>
                  <td className="log-user">
                    <User size={16} />
                    <span>{log.user}</span>
                  </td>
                  <td>
                    <span className={`role-badge ${log.role.toLowerCase()}`}>
                      {log.role === 'Doctor' ? 'Doktor' : 'Admin'}
                    </span>
                  </td>
                  <td className="log-action">{log.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default ActivityLogs;
