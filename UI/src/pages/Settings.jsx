import { useState } from 'react';
import { Bell, Save } from 'lucide-react';
import './Settings.css';

function Settings() {
  const [settings, setSettings] = useState({
    emailNotifications: true,
    pushNotifications: false,
    studyReminders: true,
    reportNotifications: true,
  });

  const handleToggle = (key) => {
    setSettings({
      ...settings,
      [key]: !settings[key],
    });
  };

  const handleSaveSettings = () => {
    alert('Settings saved successfully!');
  };

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h2>Settings</h2>
      </div>

      <div className="settings-card">
        <div className="card-header">
          <Bell size={20} />
          <h3>Notifications</h3>
        </div>

        <div className="settings-group">
          <div className="setting-item">
            <div className="setting-info">
              <h4>Email Notifications</h4>
              <p>Receive email updates about your studies</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.emailNotifications}
                onChange={() => handleToggle('emailNotifications')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <h4>Push Notifications</h4>
              <p>Get push notifications on your browser</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.pushNotifications}
                onChange={() => handleToggle('pushNotifications')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <h4>Study Reminders</h4>
              <p>Get notified about pending studies</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.studyReminders}
                onChange={() => handleToggle('studyReminders')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <h4>Report Notifications</h4>
              <p>Get notified when reports are ready</p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.reportNotifications}
                onChange={() => handleToggle('reportNotifications')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div className="settings-actions">
        <button className="btn-primary" onClick={handleSaveSettings}>
          <Save size={18} />
          Save Settings
        </button>
      </div>
    </div>
  );
}

export default Settings;
