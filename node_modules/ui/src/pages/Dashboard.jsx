import { useState, useEffect } from 'react';
import './Dashboard.css';

const API_URL = 'http://localhost:3001/api';

function Dashboard() {
  const [studies, setStudies] = useState([]);
  const [stats, setStats] = useState({ totalStudies: 0, pendingStudies: 0, completedStudies: 0, totalPatients: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Çalışmaları çek
      const studiesResponse = await fetch(`${API_URL}/studies`);
      const studiesData = await studiesResponse.json();
      
      const formattedStudies = studiesData.map(study => ({
        id: study.study_id,
        patientName: study.patient_name || 'Bilinmeyen',
        patientID: study.patient_id,
        studyDate: study.study_date,
        modality: 'CT',
        status: study.status === 'completed' ? 'Completed' : 'Pending',
        noduleCount: study.nodule_count || 0
      }));
      
      setStudies(formattedStudies);
      
      // İstatistikleri çek
      const statsResponse = await fetch(`${API_URL}/stats/dashboard`);
      const statsData = await statsResponse.json();
      setStats(statsData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const recentStudies = studies.slice(0, 5);
  const totalNodules = studies.reduce((sum, s) => sum + s.noduleCount, 0);

  if (loading) {
    return (
      <div className="dashboard">
        <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        <p>LungXAI'ye Hoşgeldiniz</p>
      </div>

      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-number">{stats.totalStudies}</div>
          <div className="stat-label">Toplam Çalışma</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{stats.pendingStudies}</div>
          <div className="stat-label">Bekleyen</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{stats.completedStudies}</div>
          <div className="stat-label">Tamamlanan</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{totalNodules}</div>
          <div className="stat-label">Toplam Nodül</div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3>Son Çalışmalar</h3>
        <div className="table-wrapper">
          <table className="studies-table">
            <thead>
              <tr>
                <th>Hasta Adı</th>
                <th>Hasta ID</th>
                <th>Tarih</th>
                <th>Modalite</th>
                <th>Durum</th>
                <th>Nodül</th>
              </tr>
            </thead>
            <tbody>
              {recentStudies.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center' }}>Henüz çalışma bulunmuyor</td>
                </tr>
              ) : (
                recentStudies.map((study) => (
                  <tr key={study.id}>
                    <td className="patient-name">{study.patientName}</td>
                    <td>{study.patientID}</td>
                    <td>{study.studyDate}</td>
                    <td>{study.modality}</td>
                    <td>
                      <span className={`status-badge status-${study.status.toLowerCase()}`}>
                        {study.status === 'Completed' ? 'Tamamlandı' : 'Bekliyor'}
                      </span>
                    </td>
                    <td>{study.noduleCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dashboard-section">
        <h3>Hızlı Bilgiler</h3>
        <div className="quick-stats">
          <div className="info-box">
            <h4>Sistem Durumu</h4>
            <p className="status-text healthy">Tüm sistemler çalışıyor</p>
          </div>
          <div className="info-box">
            <h4>Son Güncelleme</h4>
            <p className="timestamp">{new Date().toLocaleString('tr-TR')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
