import { mockStudies } from '../data/mockStudies';
import './WorkList.css';

export default function MyReports(){
  return (
    <div className="worklist">
      <div className="worklist-header">
        <h2>My Reports</h2>
        <p>Manage your authored reports</p>
      </div>

      <div className="dashboard-section">
        <div className="table-wrapper">
          <table className="worklist-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Report Date</th>
                <th>Summary</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {mockStudies.map(s=> (
                <tr key={s.id}>
                  <td>{s.patientName}</td>
                  <td>{s.studyDate}</td>
                  <td>{s.noduleCount > 0 ? `${s.noduleCount} nodules` : 'No nodules'}</td>
                  <td>Draft</td>
                  <td>
                    <button className="open-btn">View Report</button>
                    <button className="open-btn" style={{marginLeft:8}}>Download PDF</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
