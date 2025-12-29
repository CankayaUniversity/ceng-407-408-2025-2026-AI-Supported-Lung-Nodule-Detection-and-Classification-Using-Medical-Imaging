import { useState } from 'react';
import { mockStudies } from '../data/mockStudies';
import './Dashboard.css';

function Dashboard() {
  const [filter, setFilter] = useState('all');

  const recentStudies = mockStudies.slice(0, 5);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        <p>Welcome to LungXAI</p>
      </div>

      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-number">{mockStudies.length}</div>
          <div className="stat-label">Total Studies</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{mockStudies.filter(s => s.status === 'Unread').length}</div>
          <div className="stat-label">Unread Studies</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{mockStudies.filter(s => s.status === 'Reported').length}</div>
          <div className="stat-label">Reported</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{mockStudies.reduce((sum, s) => sum + s.noduleCount, 0)}</div>
          <div className="stat-label">Total Nodules</div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3>Recent Studies</h3>
        <div className="table-wrapper">
          <table className="studies-table">
            <thead>
              <tr>
                <th>Patient Name</th>
                <th>Patient ID</th>
                <th>Study Date</th>
                <th>Modality</th>
                <th>Status</th>
                <th>Nodules</th>
              </tr>
            </thead>
            <tbody>
              {recentStudies.map((study) => (
                <tr key={study.id} className={`status-${study.status.toLowerCase()}`}>
                  <td className="patient-name">{study.patientName}</td>
                  <td>{study.patientID}</td>
                  <td>{study.studyDate}</td>
                  <td>{study.modality}</td>
                  <td>
                    <span className={`status-badge status-${study.status.toLowerCase()}`}>
                      {study.status}
                    </span>
                  </td>
                  <td>{study.noduleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dashboard-section">
        <h3>Quick Stats</h3>
        <div className="quick-stats">
          <div className="info-box">
            <h4>System Status</h4>
            <p className="status-text healthy">All systems operational</p>
          </div>
          <div className="info-box">
            <h4>Last Updated</h4>
            <p className="timestamp">2025-12-23 14:32:00</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
