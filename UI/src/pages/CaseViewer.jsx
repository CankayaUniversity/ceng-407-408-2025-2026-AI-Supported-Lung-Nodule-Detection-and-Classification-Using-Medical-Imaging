import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { mockStudies } from '../data/mockStudies';
import './CaseViewer.css';

function CaseViewer() {
  const { studyId } = useParams();
  const navigate = useNavigate();

  const study = mockStudies.find(s => s.id === studyId);

  if (!study) {
    return (
      <div className="case-viewer">
        <div className="not-found">
          <h2>Study Not Found</h2>
          <p>The requested study could not be found.</p>
          <button onClick={() => navigate('/worklist')} className="back-btn">
            Back to Worklist
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="case-viewer">
      <div className="case-header">
        <button
          className="back-button"
          onClick={() => navigate('/worklist')}
          title="Back to worklist"
        >
          <ChevronLeft size={20} />
          Back
        </button>
        <div className="case-title">
          <h2>{study.patientName}</h2>
          <p>{study.patientID} | {study.studyDate}</p>
        </div>
      </div>

      <div className="case-container">
        {/* Left Panel - Nodule List */}
        <div className="nodule-list-panel">
          <div className="panel-header">
            <h3>Nodules ({study.noduleCount})</h3>
          </div>
          <div className="nodule-items">
            {study.noduleCount > 0 ? (
              Array.from({ length: study.noduleCount }).map((_, idx) => (
                <div key={idx} className="nodule-item">
                  <div className="nodule-number">#{idx + 1}</div>
                  <div className="nodule-info">
                    <p className="nodule-size">Size: {(5 + idx * 3).toFixed(1)} mm</p>
                    <p className="nodule-type">Type: {['Solid', 'Part-solid', 'GGO'][idx % 3]}</p>
                    <p className="nodule-risk">Risk: {['Low', 'Medium', 'High'][idx % 3]}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="no-nodules">
                <p>No nodules detected</p>
              </div>
            )}
          </div>
        </div>

        {/* Center Panel - Viewer */}
        <div className="viewer-panel">
          <div className="viewer-placeholder">
            <div className="placeholder-content">
              <h4>Medical Image Viewer</h4>
              <p>Study: {study.id}</p>
              <p>Modality: {study.modality}</p>
              <div className="image-mockup">
                <div className="mockup-grid"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Report */}
        <div className="report-panel">
          <div className="panel-header">
            <h3>Report</h3>
          </div>
          <div className="report-content">
            <div className="report-section">
              <h4>Study Information</h4>
              <div className="info-row">
                <span className="label">Study ID:</span>
                <span className="value">{study.id}</span>
              </div>
              <div className="info-row">
                <span className="label">Modality:</span>
                <span className="value">{study.modality}</span>
              </div>
              <div className="info-row">
                <span className="label">Date:</span>
                <span className="value">{study.studyDate}</span>
              </div>
            </div>

            <div className="report-section">
              <h4>Findings</h4>
              <p className="findings-text">
                {study.noduleCount > 0
                  ? `${study.noduleCount} nodule(s) identified in the lungs. Analysis pending radiologist review.`
                  : 'No significant findings. Study appears normal.'}
              </p>
            </div>

            <div className="report-section">
              <h4>Status</h4>
              <div className={`status-badge-large status-${study.status.toLowerCase()}`}>
                {study.status}
              </div>
            </div>

            <div className="report-actions">
              <button className="btn-primary">Save Report</button>
              <button className="btn-secondary">Add Notes</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CaseViewer;
