import { useState } from 'react';
import { Settings as SettingsIcon, Save, LogOut, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './SystemSettings.css';

function SystemSettings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState({
    activeModel: 'Model-A-v2.0',
    storageLocation: '/var/lungxai/images/',
    language: 'en',
    logLevel: 'detailed',
  });

  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleLogout = () => {
    localStorage.removeItem('userType');
    localStorage.removeItem('username');
    navigate('/login');
  };

  return (
    <div className="system-settings">
      <div className="ss-header">
        <div>
          <h1>System Settings</h1>
          <p>AI and system configuration</p>
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

      <div className="ss-content">
        {/* AI Settings */}
        <div className="settings-section">
          <div className="section-header">
            <SettingsIcon size={20} />
            <h2>AI Settings</h2>
          </div>
          
          <div className="setting-item">
            <div className="setting-label">
              <label>Active Model</label>
              <p>Currently used AI model</p>
            </div>
            <div className="setting-control">
              <select
                value={settings.activeModel}
                onChange={(e) => setSettings({ ...settings, activeModel: e.target.value })}
              >
                <option value="Model-A-v2.0">Model A v2.0 (Current)</option>
                <option value="Model-B-v1.5">Model B v1.5</option>
                <option value="Model-C-v1.0">Model C v1.0</option>
              </select>
            </div>
          </div>

          <div className="setting-info">
            <p>On the system settings page, the active AI model and some basic configurations are managed by the administrator.</p>
          </div>
        </div>

        {/* Storage Settings */}
        <div className="settings-section">
          <div className="section-header">
            <SettingsIcon size={20} />
            <h2>Storage Settings</h2>
          </div>

          <div className="setting-item">
            <div className="setting-label">
              <label>Image Storage Path</label>
              <p>Directory where medical images will be saved</p>
            </div>
            <div className="setting-control">
              <input
                type="text"
                value={settings.storageLocation}
                onChange={(e) => setSettings({ ...settings, storageLocation: e.target.value })}
                readOnly
                className="readonly"
              />
            </div>
          </div>
        </div>

        {/* General Settings */}
        <div className="settings-section">
          <div className="section-header">
            <SettingsIcon size={20} />
            <h2>General Settings</h2>
          </div>

          <div className="setting-item">
            <div className="setting-label">
              <label>Language</label>
              <p>System interface language</p>
            </div>
            <div className="setting-control">
              <select
                value={settings.language}
                onChange={(e) => setSettings({ ...settings, language: e.target.value })}
              >
                <option value="en">English</option>
                <option value="tr">Türkçe</option>
              </select>
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-label">
              <label>Log Level</label>
              <p>System logging level</p>
            </div>
            <div className="setting-control">
              <select
                value={settings.logLevel}
                onChange={(e) => setSettings({ ...settings, logLevel: e.target.value })}
              >
                <option value="detailed">Detailed</option>
                <option value="standard">Standard</option>
                <option value="minimal">Minimal</option>
              </select>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="settings-actions">
          <button className="btn-save" onClick={handleSave}>
            <Save size={18} />
            Save Settings
          </button>
          {saved && <span className="save-success">✓ Settings saved successfully</span>}
        </div>
      </div>
    </div>
  );
}

export default SystemSettings;
