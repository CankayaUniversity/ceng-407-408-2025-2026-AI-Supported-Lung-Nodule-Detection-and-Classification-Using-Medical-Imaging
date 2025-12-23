import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mockStudies } from '../data/mockStudies';
import './WorkList.css';

function WorkList() {
  const navigate = useNavigate();
  const [priority, setPriority] = useState('all');
  const [dateRange, setDateRange] = useState('today');
  const [onlyReady, setOnlyReady] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const computePriority = (s) => {
    if (s.noduleCount >= 3) return 'high';
    if (s.noduleCount === 2) return 'medium';
    if (s.noduleCount === 1) return 'low';
    return 'low';
  };

  const filtered = mockStudies.filter((s) => {
    const p = computePriority(s);
    if (priority !== 'all' && p !== priority) return false;
    if (onlyReady && s.status === 'Unread') return false;
    if (searchTerm && !s.patientName.toLowerCase().includes(searchTerm.toLowerCase()) && !s.patientID.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    
    return true;
  });

  const handleReview = (id) => navigate(`/review/${id}`);

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
                        <span className={`status-badge status-${study.status.toLowerCase()}`}>
                          {study.status}
                        </span>
                      </td>
                      <td className="action-cell">
                        <button className="open-btn" onClick={()=>handleReview(study.id)}>Review</button>
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
