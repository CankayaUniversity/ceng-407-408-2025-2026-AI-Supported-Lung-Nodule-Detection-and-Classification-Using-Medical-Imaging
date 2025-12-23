import { useState } from 'react';
import { Plus, LogOut, AlertCircle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './UserManagement.css';

function UserManagement() {
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedUserForStatus, setSelectedUserForStatus] = useState(null);
  const [users, setUsers] = useState([
    { id: 1, name: 'Dr. Ayşe', email: 'ayse@hospital.com', role: 'Doctor', status: 'Aktif', lastLogin: '23.12.2025 14:32' },
    { id: 2, name: 'Dr. Mehmet', email: 'mehmet@hospital.com', role: 'Doctor', status: 'Aktif', lastLogin: '23.12.2025 12:15' },
    { id: 3, name: 'Dr. Fatih', email: 'fatih@hospital.com', role: 'Doctor', status: 'Pasif', lastLogin: '22.12.2025 09:30' },
    { id: 4, name: 'Admin', email: 'admin@hospital.com', role: 'Admin', status: 'Aktif', lastLogin: '23.12.2025 15:20' },
  ]);

  const [newUser, setNewUser] = useState({ firstName: '', lastName: '', email: '', role: 'Doctor' });

  const handleAddUser = () => {
    if (newUser.firstName && newUser.lastName && newUser.email && newUser.role) {
      const fullName = `${newUser.firstName} ${newUser.lastName}`;
      const user = {
        id: users.length + 1,
        name: fullName,
        email: newUser.email,
        role: newUser.role,
        status: 'Aktif',
        lastLogin: 'Hiç giriş yapılmadı',
      };
      setUsers([...users, user]);
      setNewUser({ firstName: '', lastName: '', email: '', role: 'Doctor' });
      setShowModal(false);
      alert('Kullanıcı başarıyla eklendi!');
    } else {
      alert('Lütfen tüm alanları doldurunuz!');
    }
  };

  const openStatusModal = (user) => {
    setSelectedUserForStatus(user);
    setShowStatusModal(true);
  };

  const confirmStatusChange = () => {
    if (selectedUserForStatus) {
      setUsers(users.map(u => 
        u.id === selectedUserForStatus.id ? { ...u, status: u.status === 'Aktif' ? 'Pasif' : 'Aktif' } : u
      ));
      setShowStatusModal(false);
      setSelectedUserForStatus(null);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('userType');
    localStorage.removeItem('username');
    navigate('/login');
  };

  return (
    <div className="user-management">
      <div className="um-header">
        <div>
          <h1>Kullanıcı Yönetimi</h1>
          <p>Sistem kullanıcılarını yönetin</p>
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

      <div className="um-content">
        <div className="um-controls">
          <button className="btn-add-user" onClick={() => setShowModal(true)}>
            <Plus size={18} />
            Yeni Kullanıcı Ekle
          </button>
        </div>

        {/* Users Table */}
        <div className="table-wrapper">
          <table className="users-table">
            <thead>
              <tr>
                <th>Ad/Soyad</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Durum</th>
                <th>Son Giriş</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="user-name">{user.name}</td>
                  <td>{user.email}</td>
                  <td>
                    <span className={`role-badge ${user.role.toLowerCase()}`}>
                      {user.role === 'Doctor' ? 'Doktor' : 'Admin'}
                    </span>
                  </td>
                  <td>
                    <span 
                      className={`status-badge ${user.status.toLowerCase()} clickable`}
                      onClick={() => openStatusModal(user)}
                      title="Durumu değiştirmek için tıklayın"
                    >
                      {user.status}
                    </span>
                  </td>
                  <td className="last-login">{user.lastLogin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Yeni Kullanıcı Ekle</h2>
              <button className="btn-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Ad</label>
                  <input
                    type="text"
                    value={newUser.firstName}
                    onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                    placeholder="Adı girin"
                  />
                </div>
                <div className="form-group">
                  <label>Soyad</label>
                  <input
                    type="text"
                    value={newUser.lastName}
                    onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                    placeholder="Soyadı girin"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="Email adresini girin"
                />
              </div>

              <div className="form-group">
                <label>Rol</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                >
                  <option value="Doctor">Doktor</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>

              <div className="form-info">
                <p>Geçici şifre: 123456 (Kullanıcı ilk girişte değiştirmek zorunda olacak)</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowModal(false)}>İptal</button>
              <button className="btn-submit" onClick={handleAddUser}>Kullanıcı Ekle</button>
            </div>
          </div>
        </div>
      )}

      {/* Status Change Modal */}
      {showStatusModal && selectedUserForStatus && (
        <div className="modal-overlay" onClick={() => setShowStatusModal(false)}>
          <div className="modal-content status-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="header-with-icon">
                <AlertCircle size={24} className="alert-icon" />
                <h2>Kullanıcı Durumunu Değiştir</h2>
              </div>
              <button className="btn-close" onClick={() => setShowStatusModal(false)}>×</button>
            </div>
            <div className="modal-body status-body">
              <div className="status-change-content">
                <p className="user-name-info">
                  Kullanıcı: <strong>{selectedUserForStatus.name}</strong>
                </p>
                <p className="user-email-info">
                  Email: <strong>{selectedUserForStatus.email}</strong>
                </p>
                
                <div className="status-change-info">
                  <div className="current-status">
                    <span>Mevcut Durum:</span>
                    <span className={`status-badge ${selectedUserForStatus.status.toLowerCase()}`}>
                      {selectedUserForStatus.status}
                    </span>
                  </div>
                  
                  <div className="arrow">→</div>
                  
                  <div className="new-status">
                    <span>Yeni Durum:</span>
                    <span className={`status-badge ${selectedUserForStatus.status === 'Aktif' ? 'pasif' : 'aktif'}`}>
                      {selectedUserForStatus.status === 'Aktif' ? 'Pasif' : 'Aktif'}
                    </span>
                  </div>
                </div>

                <div className="status-warning">
                  {selectedUserForStatus.status === 'Aktif' 
                    ? 'Bu kullanıcı sistemine giriş yapamayacak ve hiçbir işlem yapalamayacak.' 
                    : 'Bu kullanıcı tekrar sisteme giriş yapabilecek.'}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowStatusModal(false)}>
                İptal
              </button>
              <button className="btn-confirm-status" onClick={confirmStatusChange}>
                {selectedUserForStatus.status === 'Aktif' ? 'Pasifleştir' : 'Aktifleştir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserManagement;
