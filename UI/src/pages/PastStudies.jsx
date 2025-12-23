import { useState } from 'react';
import { mockStudies } from '../data/mockStudies';
import './WorkList.css';

export default function PastStudies(){
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = mockStudies.filter(s => 
    s.patientName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.patientID.toLowerCase().includes(searchTerm.toLowerCase())
  );
  return (
    <div className="worklist">
      <div className="worklist-header">
        <h2>Past Studies</h2>
        <p>Archive of previous studies</p>
      </div>

      <div className="search-filters-section">
        <input 
          type="text" 
          placeholder="Search by Patient ID / Name" 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="worklist-search"
        />
      </div>

      <div className="dashboard-section">
        <h3>Studies</h3>
        <div className="table-wrapper">
          <table className="worklist-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Study Date</th>
                <th>AI Summary</th>
                <th>Report Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s=> (
                <tr key={s.id}>
                  <td>{s.patientName} ({s.patientID})</td>
                  <td>{s.studyDate}</td>
                  <td>{s.noduleCount} nodules</td>
                  <td>Completed</td>
                  <td><button className="open-btn">View Study</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
