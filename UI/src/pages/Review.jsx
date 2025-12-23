import { useParams, useNavigate } from 'react-router-dom';
import { mockStudies } from '../data/mockStudies';
import './Review.css';

export default function Review(){
  const { studyId } = useParams();
  const navigate = useNavigate();
  const study = mockStudies.find(s=>s.id===studyId) || mockStudies[0];

  return (
    <div className="review-page">
      <div className="review-header">
        <button className="back-button" onClick={() => navigate(-1)}>← Back to Worklist</button>
        <div className="review-title">
          <h2>{study.patientName}</h2>
          <p>{study.patientID} | {study.studyDate}</p>
        </div>
      </div>

      <div className="review-container">
        <div className="review-left-panel">
          <div className="panel-header"><h3>Patient & AI Summary</h3></div>
          <div style={{padding:16}}>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Patient ID</span>
                <span className="info-value">{study.patientID}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Age</span>
                <span className="info-value">62</span>
              </div>
              <div className="info-item">
                <span className="info-label">Gender</span>
                <span className="info-value">M</span>
              </div>
            </div>
            <div className="ai-summary-box">
              <div className="summary-item">
                <span className="summary-label">Total nodules</span>
                <span className="summary-value">{study.noduleCount}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">High risk</span>
                <span className="summary-value">{Math.max(0, Math.floor(study.noduleCount/3))}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Largest</span>
                <span className="summary-value">{study.noduleCount>0? '12.4 mm': 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="review-center-panel">
          <div className="viewer-placeholder">
            <div className="placeholder-content">
              <h4>CT Viewer</h4>
              <p>Study: {study.id}</p>
              <div className="image-mockup" style={{width:360,height:360}} />
              <div style={{marginTop:16,display:'flex',gap:8,justifyContent:'center'}}>
                <button className="open-btn">Toggle Segmentation</button>
                <button className="open-btn">Toggle Heatmap</button>
              </div>
            </div>
          </div>
        </div>

        <div className="review-right-panel">
          <div className="panel-header"><h3>Nodules</h3></div>
          <div className="nodules-list">
            {Array.from({length:study.noduleCount}).map((_,i)=> (
              <div key={i} className="nodule-card">
                <div className="nodule-header">
                  <div>
                    <strong className="nodule-title">Nodule #{i+1}</strong>
                    <div className="nodule-location">RUL • {6+i*2} mm</div>
                  </div>
                  <span className="risk-badge high">High</span>
                </div>
              </div>
            ))}
          </div>

          <div className="selected-nodule-section">
            <h4>Selected Nodule Details</h4>
            <div className="detail-form">
              <div className="form-group">
                <label className="form-label">Location</label>
                <select className="form-control">
                  <option>RUL</option>
                  <option>LUL</option>
                  <option>RML</option>
                  <option>RLL</option>
                  <option>LLL</option>
                </select>
              </div>
              
              <div className="form-group">
                <label className="form-label">Size (mm)</label>
                <input type="number" defaultValue="12.4" className="form-control" />
              </div>
              
              <div className="form-group">
                <label className="form-label">AI Probability</label>
                <input type="number" defaultValue="0.78" step="0.01" className="form-control" />
              </div>
              
              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input type="checkbox" defaultChecked /> Include in report
                </label>
              </div>
              
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea placeholder="Add clinical notes..." className="form-control textarea-control" />
              </div>

              <div className="form-actions">
                <button className="open-btn">Previous Nodule</button>
                <button className="open-btn">Next Nodule</button>
              </div>
              
              <button className="submit-report-btn">Generate Report</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

