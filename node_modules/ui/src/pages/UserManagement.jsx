import { useState, useEffect } from 'react';
import { Plus, LogOut, AlertCircle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './UserManagement.css';

const API_URL = 'http://localhost:3001/api';

function UserManagement() {
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedUserForStatus, setSelectedUserForStatus] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [newUser, setNewUser] = useState({ firstName: '', lastName: '', email: '', username: '', password: '', role: 'Doctor' });

  // Fetch users from database
  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/users`);
      const data = await response.json();
      
      // Convert database data to UI format
      const formattedUsers = data.map(user => ({
        id: user.id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        role: user.role,
        status: user.status,
        lastLogin: user.last_login 
          ? new Date(user.last_login).toLocaleString('en-US')
          : 'Never logged in'
      }));
      
      setUsers(formattedUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async () => {
    if (newUser.firstName && newUser.lastName && newUser.email && newUser.username && newUser.password && newUser.role) {
      try {
        const userData = {
          username: newUser.username,
          password: newUser.password,
          first_name: newUser.firstName,
          last_name: newUser.lastName,
          email: newUser.email,
          role: newUser.role
        };

        const response = await fetch(`${API_URL}/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(userData)
        });

        const result = await response.json();

        if (result.success) {
          // Add activity log
          await fetch(`${API_URL}/activity-logs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: parseInt(localStorage.getItem('userId')),
              username: localStorage.getItem('username'),
              action: `Added new user: ${newUser.firstName} ${newUser.lastName}`,
              action_type: 'user'
            })
          });
          
          // Refresh user list
          await fetchUsers();
          setNewUser({ firstName: '', lastName: '', email: '', username: '', password: '', role: 'Doctor' });
          setShowModal(false);
          alert('User added successfully!');
        } else {
          alert('Error: ' + result.error);
        }
      } catch (error) {
        console.error('Error adding user:', error);
        alert('An error occurred while adding user!');
      }
    } else {
      alert('Please fill in all fields!');
    }
  };

  const openStatusModal = (user) => {
    setSelectedUserForStatus(user);
    setShowStatusModal(true);
  };

  const confirmStatusChange = async () => {
    if (selectedUserForStatus) {
      try {
        const isActive = selectedUserForStatus.status === 'Active' || selectedUserForStatus.status === 'Aktif';
        const newStatus = isActive ? 'Inactive' : 'Active';
        
        const response = await fetch(`${API_URL}/users/${selectedUserForStatus.id}/status`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: newStatus })
        });

        const result = await response.json();

        if (result.success) {
          // Add activity log
          await fetch(`${API_URL}/activity-logs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: parseInt(localStorage.getItem('userId')),
              username: localStorage.getItem('username'),
              action: `${newStatus === 'Active' ? 'Activated' : 'Deactivated'} user: ${selectedUserForStatus.name}`,
              action_type: 'user'
            })
          });
          
          // Update user list
          setUsers(users.map(u => 
            u.id === selectedUserForStatus.id ? { ...u, status: newStatus } : u
          ));
          setShowStatusModal(false);
          setSelectedUserForStatus(null);
        } else {
          alert('Hata: ' + result.error);
        }
      } catch (error) {
        console.error('Error updating user status:', error);
        alert('Durum güncellenirken bir hata oluştu!');
      }
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
          <h1>User Management</h1>
          <p>Manage system users</p>
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

      <div className="um-content">
        <div className="um-controls">
          <button className="btn-add-user" onClick={() => setShowModal(true)}>
            <Plus size={18} />
            Add New User
          </button>
        </div>

        {/* Users Table */}
        <div className="table-wrapper">
          <table className="users-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '20px' }}>
                    Loading...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '20px' }}>
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id}>
                    <td className="user-name">{user.name}</td>
                    <td>{user.email}</td>
                    <td>
                      <span className={`role-badge ${user.role.toLowerCase()}`}>
                        {user.role}
                      </span>
                    </td>
                    <td>
                      <span 
                        className={`status-badge ${user.status.toLowerCase()} clickable`}
                        onClick={() => openStatusModal(user)}
                        title="Click to change status"
                      >
                        {user.status}
                      </span>
                    </td>
                    <td className="last-login">{user.lastLogin}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add New User</h2>
              <button className="btn-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>First Name</label>
                  <input
                    type="text"
                    value={newUser.firstName}
                    onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                    placeholder="Enter first name"
                  />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input
                    type="text"
                    value={newUser.lastName}
                    onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                    placeholder="Enter last name"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}  
                  placeholder="Enter email address"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Username</label>
                  <input
                    type="text"
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    placeholder="Enter username"
                  />
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="Enter password"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                >
                  <option value="Doctor">Doctor</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn-submit" onClick={handleAddUser}>Add User</button>
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
                <h2>Change User Status</h2>
              </div>
              <button className="btn-close" onClick={() => setShowStatusModal(false)}>×</button>
            </div>
            <div className="modal-body status-body">
              <div className="status-change-content">
                <p className="user-name-info">
                  User: <strong>{selectedUserForStatus.name}</strong>
                </p>
                <p className="user-email-info">
                  Email: <strong>{selectedUserForStatus.email}</strong>
                </p>
                
                <div className="status-change-info">
                  <div className="current-status">
                    <span>Current Status:</span>
                    <span className={`status-badge ${selectedUserForStatus.status.toLowerCase()}`}>
                      {selectedUserForStatus.status}
                    </span>
                  </div>
                  
                  <div className="arrow">→</div>
                  
                  <div className="new-status">
                    <span>New Status:</span>
                    <span className={`status-badge ${(selectedUserForStatus.status === 'Active' || selectedUserForStatus.status === 'Aktif') ? 'inactive' : 'active'}`}>
                      {(selectedUserForStatus.status === 'Active' || selectedUserForStatus.status === 'Aktif') ? 'Inactive' : 'Active'}
                    </span>
                  </div>
                </div>

                <div className="status-warning">
                  {(selectedUserForStatus.status === 'Active' || selectedUserForStatus.status === 'Aktif')
                    ? 'This user will not be able to log in or perform any actions.' 
                    : 'This user will be able to log in again.'}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowStatusModal(false)}>
                Cancel
              </button>
              <button className="btn-confirm-status" onClick={confirmStatusChange}>
                {(selectedUserForStatus.status === 'Active' || selectedUserForStatus.status === 'Aktif') ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserManagement;
