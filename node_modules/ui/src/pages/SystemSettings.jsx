import { useState } from 'react';
import { Settings as SettingsIcon, Save, LogOut, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './SystemSettings.css';

function SystemSettings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState({
    activeModel: 'Model-A-v2.0',
    storageLocation: '/var/lungxai/images/',
    language: 'tr',
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
          <h1>Sistem Ayarları</h1>
          <p>Yapay zeka ve sistem konfigürasyonu</p>
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

      <div className="ss-content">
        {/* AI Settings */}
        <div className="settings-section">
          <div className="section-header">
            <SettingsIcon size={20} />
            <h2>Yapay Zeka Ayarları</h2>
          </div>
          
          <div className="setting-item">
            <div className="setting-label">
              <label>Aktif Model</label>
              <p>Şu anda kullanılan yapay zeka modeli</p>
            </div>
            <div className="setting-control">
              <select
                value={settings.activeModel}
                onChange={(e) => setSettings({ ...settings, activeModel: e.target.value })}
              >
                <option value="Model-A-v2.0">Model A v2.0 (Mevcut)</option>
                <option value="Model-B-v1.5">Model B v1.5</option>
                <option value="Model-C-v1.0">Model C v1.0</option>
              </select>
            </div>
          </div>

          <div className="setting-info">
            <p>Sistem ayarları sayfasında, aktif yapay zekâ modeli ve bazı temel konfigürasyonlar admin tarafından yönetilmektedir.</p>
          </div>
        </div>

        {/* Storage Settings */}
        <div className="settings-section">
          <div className="section-header">
            <SettingsIcon size={20} />
            <h2>Depolama Ayarları</h2>
          </div>

          <div className="setting-item">
            <div className="setting-label">
              <label>Görüntü Depolama Yolu</label>
              <p>Tıbbi görüntülerin kaydedileceği dizin</p>
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
            <h2>Genel Ayarlar</h2>
          </div>

          <div className="setting-item">
            <div className="setting-label">
              <label>Dil</label>
              <p>Sistem arayüzü dili</p>
            </div>
            <div className="setting-control">
              <select
                value={settings.language}
                onChange={(e) => setSettings({ ...settings, language: e.target.value })}
              >
                <option value="tr">Türkçe</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-label">
              <label>Log Seviyesi</label>
              <p>Sistem log tutma seviyesi</p>
            </div>
            <div className="setting-control">
              <select
                value={settings.logLevel}
                onChange={(e) => setSettings({ ...settings, logLevel: e.target.value })}
              >
                <option value="detailed">Detaylı</option>
                <option value="standard">Standart</option>
                <option value="minimal">Minimal</option>
              </select>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="settings-actions">
          <button className="btn-save" onClick={handleSave}>
            <Save size={18} />
            Ayarları Kaydet
          </button>
          {saved && <span className="save-success">✓ Ayarlar başarıyla kaydedildi</span>}
        </div>
      </div>
    </div>
  );
}

export default SystemSettings;
