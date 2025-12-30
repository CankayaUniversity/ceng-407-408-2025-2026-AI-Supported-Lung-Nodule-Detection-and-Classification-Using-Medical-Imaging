import { useState, useEffect } from 'react';
import { Mail, Building2, Stethoscope, Edit2, Save, X, User, Award, Hospital } from 'lucide-react';
import './Profile.css';

const API_URL = 'http://localhost:3001/api';

function Profile() {
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  
  const [profile, setProfile] = useState({
    id: null,
    firstName: '',
    lastName: '',
    email: '',
    specialization: '',
    department: '',
    hospital: '',
    licenseNumber: '',
    role: ''
  });

  const [editData, setEditData] = useState(profile);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = () => {
    // Get user data from localStorage (set during login)
    const userId = localStorage.getItem('userId');
    const firstName = localStorage.getItem('userFirstName') || localStorage.getItem('username') || '';
    const lastName = localStorage.getItem('userLastName') || '';
    const email = localStorage.getItem('userEmail') || '';
    const role = localStorage.getItem('userType') || '';
    const specialization = localStorage.getItem('userSpecialization') || '';
    const department = localStorage.getItem('userDepartment') || '';
    const hospital = localStorage.getItem('userHospital') || '';
    const licenseNumber = localStorage.getItem('userLicenseNumber') || '';

    const userData = {
      id: userId ? parseInt(userId) : null,
      firstName,
      lastName,
      email,
      specialization,
      department,
      hospital,
      licenseNumber,
      role
    };

    setProfile(userData);
    setEditData(userData);
    setLoading(false);
  };

  const handleEdit = () => {
    setIsEditing(true);
    setEditData({ ...profile });
    setMessage({ type: '', text: '' });
  };

  const handleSave = async () => {
    if (!profile.id) {
      setMessage({ type: 'error', text: 'User ID not found' });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/users/${profile.id}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: editData.firstName,
          last_name: editData.lastName,
          email: editData.email,
          specialization: editData.specialization,
          department: editData.department,
          hospital: editData.hospital,
          license_number: editData.licenseNumber
        })
      });

      const data = await response.json();

      if (data.success) {
        // Update localStorage
        localStorage.setItem('userFirstName', editData.firstName);
        localStorage.setItem('userLastName', editData.lastName);
        localStorage.setItem('userEmail', editData.email);
        localStorage.setItem('username', `${editData.firstName} ${editData.lastName}`);
        localStorage.setItem('userSpecialization', editData.specialization || '');
        localStorage.setItem('userDepartment', editData.department || '');
        localStorage.setItem('userHospital', editData.hospital || '');
        localStorage.setItem('userLicenseNumber', editData.licenseNumber || '');

        setProfile(editData);
        setIsEditing(false);
        setMessage({ type: 'success', text: 'Profile updated successfully!' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update profile' });
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      setMessage({ type: 'error', text: 'Failed to update profile. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditData(profile);
    setMessage({ type: '', text: '' });
  };

  const handleChange = (field, value) => {
    setEditData({ ...editData, [field]: value });
  };

  if (loading) {
    return (
      <div className="profile-container">
        <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <div className="profile-header">
        <div className="header-content">
          <h2>Account Profile</h2>
          <p>Manage your profile information</p>
        </div>
        {!isEditing && (
          <button className="edit-btn" onClick={handleEdit}>
            <Edit2 size={18} />
            Edit Profile
          </button>
        )}
      </div>

      {message.text && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="profile-card">
        {isEditing ? (
          // Edit Mode
          <div className="form-container">
            <div className="form-row">
              <div className="form-group">
                <label>First Name</label>
                <input
                  type="text"
                  value={editData.firstName}
                  onChange={(e) => handleChange('firstName', e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>Last Name</label>
                <input
                  type="text"
                  value={editData.lastName}
                  onChange={(e) => handleChange('lastName', e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={editData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label>Specialization</label>
              <input
                type="text"
                value={editData.specialization}
                onChange={(e) => handleChange('specialization', e.target.value)}
                className="form-input"
                placeholder="e.g., Radiology, Pulmonology"
              />
            </div>

            <div className="form-group">
              <label>Department</label>
              <input
                type="text"
                value={editData.department}
                onChange={(e) => handleChange('department', e.target.value)}
                className="form-input"
                placeholder="e.g., Radiology Department"
              />
            </div>

            <div className="form-group">
              <label>Hospital</label>
              <input
                type="text"
                value={editData.hospital}
                onChange={(e) => handleChange('hospital', e.target.value)}
                className="form-input"
                placeholder="e.g., Medical Center Hospital"
              />
            </div>

            <div className="form-group">
              <label>License Number</label>
              <input
                type="text"
                value={editData.licenseNumber}
                onChange={(e) => handleChange('licenseNumber', e.target.value)}
                className="form-input"
                placeholder="e.g., MD-123456"
              />
            </div>

            <div className="form-actions">
              <button className="btn-save" onClick={handleSave} disabled={saving}>
                <Save size={18} />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button className="btn-cancel" onClick={handleCancel} disabled={saving}>
                <X size={18} />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          // View Mode
          <div className="profile-view">
            <div className="profile-avatar">
              <User size={48} />
              <div className="avatar-info">
                <h3>{profile.firstName} {profile.lastName}</h3>
                <span className="role-badge">{profile.role}</span>
              </div>
            </div>

            <div className="info-section">
              <div className="info-row">
                <div className="info-label">
                  <Mail size={16} />
                  Email
                </div>
                <div className="info-value">{profile.email || 'Not specified'}</div>
              </div>

              <div className="info-row">
                <div className="info-label">
                  <Stethoscope size={16} />
                  Specialization
                </div>
                <div className="info-value">{profile.specialization || 'Not specified'}</div>
              </div>

              <div className="info-row">
                <div className="info-label">
                  <Building2 size={16} />
                  Department
                </div>
                <div className="info-value">{profile.department || 'Not specified'}</div>
              </div>

              <div className="info-row">
                <div className="info-label">
                  <Hospital size={16} />
                  Hospital
                </div>
                <div className="info-value">{profile.hospital || 'Not specified'}</div>
              </div>

              <div className="info-row">
                <div className="info-label">
                  <Award size={16} />
                  License Number
                </div>
                <div className="info-value">{profile.licenseNumber || 'Not specified'}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Profile;
