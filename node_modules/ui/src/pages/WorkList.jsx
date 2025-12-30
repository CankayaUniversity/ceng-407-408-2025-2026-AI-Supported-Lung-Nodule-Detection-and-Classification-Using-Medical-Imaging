import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './WorkList.css';

const API_URL = 'http://localhost:3001/api';

function WorkList() {
  const navigate = useNavigate();
  const [priority, setPriority] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [onlyReady, setOnlyReady] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStudies();
  }, []);

  const loadStudies = async () => {
    try {
      // Fetch studies and reports in parallel
      const [studiesRes, reportsRes] = await Promise.all([
        fetch(`${API_URL}/studies`),
        fetch(`${API_URL}/reports`)
      ]);
      
      const data = await studiesRes.json();
      const reportsData = await reportsRes.json();
      
      // Get study IDs that have reports
      const studyIdsWithReports = new Set(reportsData.map(r => r.study_id));
      
      // Filter out studies that have reports (move them to Past Studies)
      const dbStudies = data
        .filter(study => !studyIdsWithReports.has(study.study_id))
        .map(study => {
          // Determine status based on reviewed and completion status
          let displayStatus;
          if (study.reviewed) {
            displayStatus = 'Reviewed';
          } else if (study.status === 'completed') {
            displayStatus = 'AI Results Ready';
          } else {
            displayStatus = 'Pending';
          }
          
          return {
            id: study.study_id,
            patientName: study.patient_name || 'Unknown Patient',
            patientID: study.patient_id,
            studyDate: study.study_date,
            modality: 'CT',
            bodyPart: 'Chest',
            noduleCount: study.nodule_count || 0,
            description: study.description || '',
            status: displayStatus,
            reviewed: study.reviewed || false
          };
        });
      
      setStudies(dbStudies);
      setLoading(false);
    } catch (error) {
      console.error('Error loading studies:', error);
      setStudies([]);
      setLoading(false);
    }
  };

  const computePriority = (s) => {
    if (s.noduleCount >= 3) return 'high';
    if (s.noduleCount === 2) return 'medium';
    if (s.noduleCount === 1) return 'low';
    return 'low';
  };

  const filterByDate = (study) => {
    if (dateRange === 'all') return true;
    const studyDate = new Date(study.studyDate);
    const now = new Date();
    switch (dateRange) {
      case 'today':
        return studyDate.toDateString() === now.toDateString();
      case '7d':
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return studyDate >= weekAgo;
      case '30d':
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return studyDate >= monthAgo;
      default:
        return true;
    }
  };

  const filtered = studies.filter((s) => {
    const p = computePriority(s);
    if (priority !== 'all' && p !== priority) return false;
    if (onlyReady && s.status !== 'AI Results Ready') return false;
    if (!filterByDate(s)) return false;
    if (searchTerm && !s.patientName.toLowerCase().includes(searchTerm.toLowerCase()) && !s.patientID.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    
    return true;
  });

  const handleReview = (id) => navigate(`/review/${id}`);

  const handleDeletePatient = async (patientId, patientName) => {
    const confirmed = window.confirm(`Are you sure you want to delete patient "${patientName}"?\n\nThis will permanently delete:\n- All studies\n- All DICOM files\n- All nodule data\n- All reports\n\nThis action cannot be undone.`);
    
    if (!confirmed) return;
    
    try {
      const response = await fetch(`${API_URL}/patients/${patientId}`, {
        method: 'DELETE'
      });
      const result = await response.json();
      
      if (result.success) {
        alert('Patient deleted successfully!');
        loadStudies(); // Refresh the list
      } else {
        alert('Error: ' + (result.error || 'Failed to delete patient'));
      }
    } catch (error) {
      console.error('Error deleting patient:', error);
      alert('Error deleting patient: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div className="worklist">
        <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh'}}>
          <p>Loading studies...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="worklist">
      <div className="worklist-header">
        <h2>Your Worklist for Today</h2>
        <p>What patients do you need to review today?</p>
      </div>

      <div className="search-filters-section">
        <input 
          type="text" 
          placeholder="Search by patient name or ID..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="worklist-search"
        />
      </div>

      <div className="filter-tabs" style={{alignItems:'center'}}>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <label style={{fontWeight:600,marginRight:8}}>Priority</label>
          <button className={`filter-btn ${priority==='all' ? 'active' : ''}`} onClick={()=>setPriority('all')}>All</button>
          <button className={`filter-btn ${priority==='high' ? 'active' : ''}`} onClick={()=>setPriority('high')}>High Risk</button>
          <button className={`filter-btn ${priority==='medium' ? 'active' : ''}`} onClick={()=>setPriority('medium')}>Medium Risk</button>
          <button className={`filter-btn ${priority==='low' ? 'active' : ''}`} onClick={()=>setPriority('low')}>Low Risk</button>
        </div>

        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <label style={{fontWeight:600,marginRight:8}}>Date</label>
          <button className={`filter-btn ${dateRange==='today' ? 'active' : ''}`} onClick={()=>setDateRange('today')}>Today</button>
          <button className={`filter-btn ${dateRange==='7d' ? 'active' : ''}`} onClick={()=>setDateRange('7d')}>Last 7 Days</button>
          <button className={`filter-btn ${dateRange==='30d' ? 'active' : ''}`} onClick={()=>setDateRange('30d')}>Last 30 Days</button>
        </div>

        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          <label style={{display:'flex',alignItems:'center',gap:6}}>
            <input type="checkbox" checked={onlyReady} onChange={(e)=>setOnlyReady(e.target.checked)} />
            Show only studies with AI results ready
          </label>
        </div>
      </div>

      <div className="worklist-container">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <p>No studies found</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="worklist-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Patient</th>
                  <th>Scan Date</th>
                  <th>AI Summary</th>
                  <th>Notes</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((study) => {
                  const p = computePriority(study);
                  return (
                    <tr key={study.id} className={`status-${study.status.toLowerCase()}`}>
                      <td>
                        <span style={{display:'inline-block',width:12,height:12,borderRadius:6,background: p==='high'?'#ef4444':p==='medium'?'#f59e0b':'#10b981'}} />
                      </td>
                      <td className="patient-name">{study.patientName} <div style={{fontSize:12,color:'var(--color-text-secondary)'}}>{study.patientID}</div></td>
                      <td>{study.studyDate}</td>
                      <td>{study.noduleCount>0? `${study.noduleCount} nodule(s)`:'No nodules'}</td>
                      <td className="description">{study.description}</td>
                      <td>
                        <span className={`status-badge`} style={{
                          backgroundColor: study.status === 'Reviewed' ? '#10b981' : study.status === 'AI Results Ready' ? '#3b82f6' : '#9ca3af',
                          color: 'white',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px'
                        }}>
                          {study.status}
                        </span>
                      </td>
                      <td className="action-cell">
                        <button className="open-btn" onClick={()=>handleReview(study.id)}>Review</button>
                        <button className="delete-btn" onClick={()=>handleDeletePatient(study.patientID, study.patientName)} title="Delete Patient">Delete</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkList;
