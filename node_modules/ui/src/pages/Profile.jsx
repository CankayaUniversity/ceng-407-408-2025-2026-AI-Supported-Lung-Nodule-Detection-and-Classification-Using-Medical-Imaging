import { useState } from 'react';
import { Mail, Building2, Stethoscope, Edit2, Save, X } from 'lucide-react';
import './Profile.css';

function Profile() {
  const [isEditing, setIsEditing] = useState(false);
  const [profile, setProfile] = useState({
    name: 'Mr. Smith',
    email: 'smith@lungxai.com',
    specialization: 'Radiologist',
    department: 'Radiology',
    hospital: 'Medical Center Hospital',
    licenseNumber: 'MD-123456',
  });

  const [editData, setEditData] = useState(profile);

  const handleEdit = () => {
    setIsEditing(true);
    setEditData(profile);
  };

  const handleSave = () => {
    setProfile(editData);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleChange = (field, value) => {
    setEditData({ ...editData, [field]: value });
  };

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

      <div className="profile-card">
        {isEditing ? (
          // Edit Mode
          <div className="form-container">
            <div className="form-group">
              <label>Full Name</label>
              <input
                type="text"
                value={editData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className="form-input"
              />
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
              />
            </div>

            <div className="form-group">
              <label>Department</label>
              <input
                type="text"
                value={editData.department}
                onChange={(e) => handleChange('department', e.target.value)}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label>Hospital</label>
              <input
                type="text"
                value={editData.hospital}
                onChange={(e) => handleChange('hospital', e.target.value)}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label>License Number</label>
              <input
                type="text"
                value={editData.licenseNumber}
                onChange={(e) => handleChange('licenseNumber', e.target.value)}
                className="form-input"
              />
            </div>

            <div className="form-actions">
              <button className="btn-save" onClick={handleSave}>
                <Save size={18} />
                Save Changes
              </button>
              <button className="btn-cancel" onClick={handleCancel}>
                <X size={18} />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          // View Mode
          <div className="profile-view">
            <div className="info-row">
              <div className="info-label">Name</div>
              <div className="info-value">{profile.name}</div>
            </div>

            <div className="info-row">
              <div className="info-label">
                <Mail size={16} />
                Email
              </div>
              <div className="info-value">{profile.email}</div>
            </div>

            <div className="info-row">
              <div className="info-label">
                <Stethoscope size={16} />
                Specialization
              </div>
              <div className="info-value">{profile.specialization}</div>
            </div>

            <div className="info-row">
              <div className="info-label">
                <Building2 size={16} />
                Department
              </div>
              <div className="info-value">{profile.department}</div>
            </div>

            <div className="info-row">
              <div className="info-label">Hospital</div>
              <div className="info-value">{profile.hospital}</div>
            </div>

            <div className="info-row">
              <div className="info-label">License Number</div>
              <div className="info-value">{profile.licenseNumber}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Profile;
