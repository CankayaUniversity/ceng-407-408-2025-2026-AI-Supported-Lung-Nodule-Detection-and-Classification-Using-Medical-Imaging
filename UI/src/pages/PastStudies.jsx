import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import './WorkList.css';

const API_URL = 'http://localhost:3001/api';

export default function PastStudies(){
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [studies, setStudies] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      // Fetch studies and reports in parallel
      const [studiesRes, reportsRes] = await Promise.all([
        fetch(`${API_URL}/studies`),
        fetch(`${API_URL}/reports`)
      ]);
      
      const studiesData = await studiesRes.json();
      const reportsData = await reportsRes.json();
      
      setReports(reportsData);
      
      // Get study IDs that have reports
      const studyIdsWithReports = new Set(reportsData.map(r => r.study_id));
      
      // Only show studies that have reports (archived/completed workflow)
      const formattedStudies = studiesData
        .filter(s => studyIdsWithReports.has(s.study_id))
        .map(study => {
          const report = reportsData.find(r => r.study_id === study.study_id);
          return {
            id: study.study_id,
            patientName: study.patient_name || 'Unknown',
            patientID: study.patient_id,
            studyDate: study.study_date,
            noduleCount: study.nodule_count || 0,
            hasReport: true,
            reportId: report?.report_id,
            reportDate: report?.created_at,
            createdAt: study.created_at
          };
        });
      setStudies(formattedStudies);
    } catch (error) {
      console.error('Error fetching data:', error);
      setStudies([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const filterByDate = (study) => {
    if (dateFilter === 'all') return true;
    
    const studyDate = new Date(study.createdAt || study.studyDate);
    const now = new Date();
    
    switch (dateFilter) {
      case 'today':
        return studyDate.toDateString() === now.toDateString();
      case 'week':
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return studyDate >= weekAgo;
      case 'month':
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return studyDate >= monthAgo;
      case 'year':
        const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        return studyDate >= yearAgo;
      default:
        return true;
    }
  };

  const filtered = studies.filter(s => {
    const matchesSearch = s.patientName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          s.patientID.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDate = filterByDate(s);
    return matchesSearch && matchesDate;
  });

  const handleView = (studyId) => {
    navigate(`/review/${studyId}`);
  };

  const handleRefresh = () => {
    fetchData(true);
  };

  if (loading) {
    return (
      <div className="worklist">
        <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="worklist">
      <div className="worklist-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2>Past Studies</h2>
            <p>Archive of studies with generated reports</p>
          </div>
          <button 
            onClick={handleRefresh} 
            disabled={refreshing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              opacity: refreshing ? 0.7 : 1
            }}
          >
            <RefreshCw size={16} className={refreshing ? 'spinning' : ''} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="search-filters-section">
        <input 
          type="text" 
          placeholder="Search by patient name or ID..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="worklist-search"
        />
        <select 
          value={dateFilter} 
          onChange={(e) => setDateFilter(e.target.value)}
          className="filter-select"
          style={{ marginLeft: '10px', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd' }}
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">Last 7 Days</option>
          <option value="month">Last 30 Days</option>
          <option value="year">Last Year</option>
        </select>
      </div>

      <div className="dashboard-section">
        <h3>Completed Studies ({filtered.length})</h3>
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
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center' }}>No completed studies found</td>
                </tr>
              ) : (
                filtered.map(s => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: '500' }}>{s.patientName}</div>
                      <div style={{ fontSize: '12px', color: '#666' }}>{s.patientID}</div>
                    </td>
                    <td>{s.studyDate}</td>
                    <td>
                      <span style={{ 
                        padding: '4px 8px', 
                        borderRadius: '12px', 
                        fontSize: '12px',
                        backgroundColor: s.noduleCount > 2 ? '#fee2e2' : s.noduleCount > 0 ? '#fef3c7' : '#dcfce7',
                        color: s.noduleCount > 2 ? '#dc2626' : s.noduleCount > 0 ? '#d97706' : '#16a34a'
                      }}>
                        {s.noduleCount} nodule{s.noduleCount !== 1 ? 's' : ''} detected
                      </span>
                    </td>
                    <td>
                      {s.hasReport ? (
                        <span style={{ color: '#16a34a', fontWeight: '500' }}>Report Generated</span>
                      ) : (
                        <span style={{ color: '#6b7280' }}>No Report</span>
                      )}
                    </td>
                    <td>
                      <button 
                        className="open-btn" 
                        onClick={() => handleView(s.id)}
                        style={{ marginRight: '8px' }}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
