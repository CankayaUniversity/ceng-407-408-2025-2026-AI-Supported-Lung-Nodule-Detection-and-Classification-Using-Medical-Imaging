import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './Review.css';
import { studyAPI, noduleAPI } from '../services/api';
import { cornerstone, displayDicomImage, enableImageTools, resetViewport, cornerstoneWADOImageLoader } from '../utils/dicomUtils';

const API_URL = 'http://localhost:3001/api';

// Window presets for CT imaging
const WINDOW_PRESETS = {
  lung: { ww: 1500, wc: -600, name: 'Lung' },
  mediastinum: { ww: 350, wc: 50, name: 'Mediastinum' },
  bone: { ww: 2000, wc: 500, name: 'Bone' },
  soft: { ww: 400, wc: 40, name: 'Soft Tissue' }
};

// XAI explanation templates based on risk level
const XAI_EXPLANATIONS = {
  high: [
    { feature: 'Irregular margins', confidence: 0.89 },
    { feature: 'Spiculated appearance', confidence: 0.82 },
    { feature: 'Solid density pattern', confidence: 0.78 },
    { feature: 'Size > 8mm', confidence: 0.95 }
  ],
  medium: [
    { feature: 'Part-solid pattern', confidence: 0.72 },
    { feature: 'Lobulated margins', confidence: 0.68 },
    { feature: 'Ground-glass component', confidence: 0.65 }
  ],
  low: [
    { feature: 'Smooth margins', confidence: 0.85 },
    { feature: 'Calcification present', confidence: 0.72 },
    { feature: 'Stable size', confidence: 0.90 }
  ]
};

export default function Review(){
  const { studyId } = useParams();
  const navigate = useNavigate();
  const viewerRef = useRef(null);
  
  // Core state
  const [study, setStudy] = useState(null);
  const [dicomFiles, setDicomFiles] = useState([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [imageLoading, setImageLoading] = useState(false);
  
  // Viewer state
  const [viewerReady, setViewerReady] = useState(false);
  const [windowLevel, setWindowLevel] = useState(WINDOW_PRESETS.lung);
  const [activePreset, setActivePreset] = useState('lung');
  const [zoom, setZoom] = useState(1);
  const [showSegmentation, setShowSegmentation] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  
  // Layout state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  
  // Nodule state
  const [nodules, setNodules] = useState([]);
  const [selectedNodule, setSelectedNodule] = useState(0);
  
  // Report state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportGenerating, setReportGenerating] = useState(false);

  useEffect(() => {
    loadStudyData();
  }, [studyId]);

  // Preload all DICOM images for smooth scrolling
  useEffect(() => {
    if (dicomFiles.length === 0) return;
    
    const preloadImages = async () => {
      console.log(`Preloading ${dicomFiles.length} DICOM images...`);
      const promises = dicomFiles.map((file, index) => {
        const imageId = `wadouri:http://localhost:3001${file.file_path}`;
        return cornerstone.loadAndCacheImage(imageId).catch(err => {
          console.warn(`Failed to preload image ${index}:`, err.message);
          return null;
        });
      });
      
      // Load in batches to avoid overwhelming the browser
      const batchSize = 10;
      for (let i = 0; i < promises.length; i += batchSize) {
        await Promise.all(promises.slice(i, i + batchSize));
        console.log(`Preloaded ${Math.min(i + batchSize, promises.length)}/${promises.length} images`);
      }
      console.log('All images preloaded!');
    };
    
    preloadImages();
  }, [dicomFiles]);

  // Load current image when index changes - fast because it's cached
  useEffect(() => {
    if (dicomFiles.length > 0 && viewerRef.current) {
      loadDicomImage(currentImageIndex);
    }
  }, [currentImageIndex, dicomFiles.length]);

  // Also load when viewerReady changes
  useEffect(() => {
    if (viewerReady && dicomFiles.length > 0) {
      loadDicomImage(currentImageIndex);
    }
  }, [viewerReady]);

  // Initialize cornerstone when dicomFiles are loaded
  useEffect(() => {
    if (!viewerRef.current || dicomFiles.length === 0) return;
    
    let timeoutId;
    let retryCount = 0;
    const maxRetries = 30;
    
    const initCornerstone = () => {
      try {
        const element = viewerRef.current;
        if (!element) {
          console.log('No element found, retrying...');
          retryCount++;
          if (retryCount < maxRetries) {
            timeoutId = setTimeout(initCornerstone, 100);
          }
          return;
        }
        
        // Force element to have dimensions
        if (!element.style.width) element.style.width = '100%';
        if (!element.style.height) element.style.height = '600px';
        
        const rect = element.getBoundingClientRect();
        console.log(`Cornerstone init attempt ${retryCount + 1}: dimensions ${rect.width}x${rect.height}`);
        
        if (rect.width < 50 || rect.height < 50) {
          retryCount++;
          if (retryCount < maxRetries) {
            console.log('Element too small, retrying in 100ms...');
            timeoutId = setTimeout(initCornerstone, 100);
            return;
          }
          // Force dimensions if still too small
          element.style.width = '800px';
          element.style.height = '600px';
          console.log('Forced dimensions to 800x600');
        }
        
        // Try to enable cornerstone
        try {
          cornerstone.getEnabledElement(element);
          console.log('Cornerstone already enabled');
          setViewerReady(true);
        } catch (e) {
          try {
            cornerstone.enable(element);
            console.log('Cornerstone enabled successfully, element:', element);
            setViewerReady(true);
          } catch (enableError) {
            console.error('Failed to enable cornerstone:', enableError);
            retryCount++;
            if (retryCount < maxRetries) {
              timeoutId = setTimeout(initCornerstone, 200);
            }
          }
        }
      } catch (e) {
        console.error('Error in cornerstone init:', e);
      }
    };
    
    // Start initialization after a short delay
    timeoutId = setTimeout(initCornerstone, 100);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (viewerRef.current) {
        try {
          cornerstone.disable(viewerRef.current);
        } catch (e) {}
      }
    };
  }, [dicomFiles.length]);

  // Handle window resize to update cornerstone
  useEffect(() => {
    const handleResize = () => {
      if (viewerRef.current && viewerReady) {
        try {
          cornerstone.resize(viewerRef.current, true);
        } catch (e) {
          console.error('Error resizing cornerstone:', e);
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [viewerReady]);

  // Mouse wheel scroll for slice navigation
  useEffect(() => {
    const element = viewerRef.current;
    if (!element || dicomFiles.length === 0) return;
    
    const handleWheel = (e) => {
      e.preventDefault();
      if (e.deltaY > 0) {
        // Scroll down - next slice
        setCurrentImageIndex(prev => Math.min(prev + 1, dicomFiles.length - 1));
      } else {
        // Scroll up - previous slice
        setCurrentImageIndex(prev => Math.max(prev - 1, 0));
      }
    };
    
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [dicomFiles.length]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentImageIndex > 0) setCurrentImageIndex(prev => prev - 1);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (currentImageIndex < dicomFiles.length - 1) setCurrentImageIndex(prev => prev + 1);
      } else if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentImageIndex, dicomFiles.length]);

  const loadStudyData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/studies/${studyId}`);
      
      if (response.ok) {
        const studyData = await response.json();
        
        setStudy({
          id: studyData.study_id,
          patientName: studyData.patient_name || 'Unknown',
          patientID: studyData.patient_id,
          studyDate: studyData.study_date,
          modality: 'CT',
          status: studyData.status === 'completed' ? 'Completed' : 'Pending',
          noduleCount: studyData.nodule_count || 0,
          description: studyData.description || 'CT Chest Study',
          age: studyData.patient_age,
          gender: studyData.patient_gender,
          clinicalInfo: studyData.clinical_note || null,
          hasPreviousCT: Math.random() > 0.5
        });
        
        if (studyData.dicomFiles && studyData.dicomFiles.length > 0) {
          console.log('DICOM files found:', studyData.dicomFiles.length);
          const sortedFiles = studyData.dicomFiles.sort((a, b) => 
            a.file_name.localeCompare(b.file_name, undefined, { numeric: true })
          );
          setDicomFiles(sortedFiles);
          console.log('First DICOM file:', sortedFiles[0]);
        } else {
          console.log('No DICOM files found for this study');
        }

        // Generate enhanced nodules with XAI data
        const noduleCount = studyData.nodule_count || 0;
        const locations = ['RUL', 'LUL', 'RML', 'RLL', 'LLL'];
        const mockNodules = Array.from({ length: noduleCount }, (_, i) => {
          const risk = i < noduleCount / 3 ? 'high' : i < noduleCount * 2 / 3 ? 'medium' : 'low';
          return {
            id: i + 1,
            location: locations[i % 5],
            locationFull: getLocationFullName(locations[i % 5]),
            size: (6 + i * 2.5).toFixed(1),
            probability: (0.65 + Math.random() * 0.3).toFixed(2),
            risk: risk,
            sliceIndex: Math.floor(Math.random() * (studyData.dicomFiles?.length || 1)),
            reviewed: false,
            includeInReport: true,
            notes: '',
            doctorAssessment: '',
            xaiExplanations: XAI_EXPLANATIONS[risk],
            coordinates: { x: 45 + Math.random() * 10, y: 40 + Math.random() * 20 }
          };
        });
        setNodules(mockNodules);
        
        // Mark study as reviewed when opened
        const userId = localStorage.getItem('userId');
        try {
          await fetch(`${API_URL}/studies/${studyId}/reviewed`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId ? parseInt(userId) : null })
          });
        } catch (err) {
          console.error('Error marking study as reviewed:', err);
        }
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Error loading study:', error);
      setLoading(false);
    }
  };

  const getLocationFullName = (abbr) => {
    const names = {
      'RUL': 'Right Upper Lobe',
      'RML': 'Right Middle Lobe',
      'RLL': 'Right Lower Lobe',
      'LUL': 'Left Upper Lobe',
      'LLL': 'Left Lower Lobe'
    };
    return names[abbr] || abbr;
  };

  const loadDicomImage = async (index) => {
    if (!viewerRef.current || !dicomFiles[index]) {
      return;
    }

    try {
      const file = dicomFiles[index];
      const imageId = `wadouri:http://localhost:3001${file.file_path}`;
      
      // Ensure cornerstone is enabled on the element
      try {
        cornerstone.getEnabledElement(viewerRef.current);
      } catch (e) {
        cornerstone.enable(viewerRef.current);
      }
      
      // This will be instant if image is already cached
      const image = await cornerstone.loadAndCacheImage(imageId);
      
      // Display immediately without resize delay
      cornerstone.displayImage(viewerRef.current, image);
      
      // Apply current viewport settings (preserve zoom and window/level between slices)
      const viewport = cornerstone.getViewport(viewerRef.current);
      if (viewport) {
        viewport.voi.windowWidth = windowLevel.ww;
        viewport.voi.windowCenter = windowLevel.wc;
        viewport.scale = zoom;
        cornerstone.setViewport(viewerRef.current, viewport);
      }
      
      enableImageTools(viewerRef.current);
    } catch (error) {
      console.error('Error loading DICOM image:', error);
    }
  };

  const applyWindowPreset = (presetKey) => {
    setActivePreset(presetKey);
    const preset = WINDOW_PRESETS[presetKey];
    setWindowLevel(preset);
    
    if (viewerRef.current) {
      const viewport = cornerstone.getViewport(viewerRef.current);
      if (viewport) {
        viewport.voi.windowWidth = preset.ww;
        viewport.voi.windowCenter = preset.wc;
        cornerstone.setViewport(viewerRef.current, viewport);
      }
    }
  };

  const handleSliderChange = (e) => {
    setCurrentImageIndex(parseInt(e.target.value));
  };

  const handleResetView = () => {
    if (viewerRef.current) {
      try {
        const enabledElement = cornerstone.getEnabledElement(viewerRef.current);
        if (enabledElement && enabledElement.image) {
          const viewport = cornerstone.getDefaultViewportForImage(viewerRef.current, enabledElement.image);
          cornerstone.setViewport(viewerRef.current, viewport);
          setZoom(1);
          applyWindowPreset('lung');
        }
      } catch (e) {
        console.error('Error resetting view:', e);
      }
    }
  };

  const handleZoom = (delta) => {
    const newZoom = Math.min(Math.max(zoom + delta, 0.25), 4);
    setZoom(newZoom);
    if (viewerRef.current) {
      const viewport = cornerstone.getViewport(viewerRef.current);
      if (viewport) {
        viewport.scale = newZoom;
        cornerstone.setViewport(viewerRef.current, viewport);
      }
    }
  };

  const goToNoduleSlice = (nodule, index) => {
    if (nodule.sliceIndex !== undefined && nodule.sliceIndex < dicomFiles.length) {
      setCurrentImageIndex(nodule.sliceIndex);
    }
    setSelectedNodule(index);
    updateNodule(index, 'reviewed', true);
  };

  const updateNodule = async (index, field, value) => {
    setNodules(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
    
    // Save to backend if nodule has an id
    const nodule = nodules[index];
    if (nodule && nodule.id) {
      try {
        const fieldMapping = {
          'doctorAssessment': 'doctor_assessment',
          'includeInReport': 'include_in_report',
          'sliceIndex': 'slice_index',
          'size': 'size_mm'
        };
        const dbField = fieldMapping[field] || field;
        await noduleAPI.update(nodule.id, { [dbField]: value });
      } catch (error) {
        console.error('Error saving nodule update:', error);
      }
    }
  };

  const goToNextNodule = () => {
    if (selectedNodule < nodules.length - 1) {
      const nextIndex = selectedNodule + 1;
      setSelectedNodule(nextIndex);
      goToNoduleSlice(nodules[nextIndex], nextIndex);
    }
  };

  const goToPrevNodule = () => {
    if (selectedNodule > 0) {
      const prevIndex = selectedNodule - 1;
      setSelectedNodule(prevIndex);
      goToNoduleSlice(nodules[prevIndex], prevIndex);
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    if (!isFullscreen) {
      setLeftPanelCollapsed(true);
      setRightPanelCollapsed(false);
    } else {
      setLeftPanelCollapsed(false);
    }
  };

  const generateReport = async () => {
    setReportGenerating(true);
    
    try {
      const reportData = {
        study_id: studyId,
        patient_id: study.patientID,
        patient_name: study.patientName,
        study_date: study.studyDate,
        nodule_count: nodules.length,
        included_nodule_count: nodules.filter(n => n.includeInReport).length,
        report_data: {
          study: study,
          nodules: nodules.filter(n => n.includeInReport),
          allNodules: nodules,
          generatedAt: new Date().toISOString()
        },
        generated_by: localStorage.getItem('userFirstName') + ' ' + localStorage.getItem('userLastName'),
        generated_by_id: parseInt(localStorage.getItem('userId')) || null
      };
      
      const response = await fetch(`${API_URL}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData)
      });
      
      const result = await response.json();
      
      if (result.success) {
        setReportGenerating(false);
        setShowReportModal(false);
        alert('Report saved successfully!\n\nIncluded nodules: ' + 
          nodules.filter(n => n.includeInReport).length + ' of ' + nodules.length + 
          '\n\nYou can view and download the report from My Reports page.');
      } else {
        throw new Error(result.error || 'Failed to save report');
      }
    } catch (error) {
      console.error('Error saving report:', error);
      setReportGenerating(false);
      alert('Error saving report: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div className="review-page">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading study...</p>
        </div>
      </div>
    );
  }

  if (!study) {
    return (
      <div className="review-page">
        <div className="loading-container">
          <h3>Study Not Found</h3>
          <p>The requested study could not be found.</p>
          <button className="back-button" onClick={() => navigate('/worklist')}>
            ← Back to Worklist
          </button>
        </div>
      </div>
    );
  }

  const currentNodule = nodules[selectedNodule];

  return (
    <div className={`review-page ${isFullscreen ? 'fullscreen' : ''}`}>
      {/* Header */}
      <div className="review-header">
        <div className="header-left">
          <button className="back-button" onClick={() => navigate('/worklist')}>
            ← Back
          </button>
          <div className="review-title">
            <h2>{study.patientName}</h2>
            <p>{study.patientID} | {study.studyDate}</p>
          </div>
        </div>
        <div className="header-center">
          <span className={`status-badge ${study.status?.toLowerCase()}`}>
            {study.status}
          </span>
          <span className="nodule-badge">
            {nodules.filter(n => n.reviewed).length}/{nodules.length} Reviewed
          </span>
        </div>
        <div className="header-right">
          <button className="header-btn primary" onClick={() => setShowReportModal(true)}>
            Generate Report
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="review-container">
        {/* Left Panel */}
        <div className="review-left-panel">
              <div className="panel-header"><h3>Patient Info</h3></div>
              <div className="panel-content">
                <table className="info-table">
                  <tbody>
                    <tr><td className="info-label">Patient ID</td><td className="info-value">{study.patientID}</td></tr>
                    <tr><td className="info-label">Name</td><td className="info-value">{study.patientName}</td></tr>
                    <tr><td className="info-label">Age</td><td className="info-value">{study.age || 'N/A'}</td></tr>
                    <tr><td className="info-label">Gender</td><td className="info-value">{study.gender || 'N/A'}</td></tr>
                    <tr><td className="info-label">Study Date</td><td className="info-value">{study.studyDate}</td></tr>
                    <tr><td className="info-label">Modality</td><td className="info-value">{study.modality}</td></tr>
                  </tbody>
                </table>

                {study.clinicalInfo && (
                  <div className="clinical-info-box">
                    <h4>Clinical Notes</h4>
                    <p>{study.clinicalInfo}</p>
                  </div>
                )}

                {study.hasPreviousCT && (
                  <div className="previous-ct-alert">
                    <span>!</span><span>Previous CT available</span>
                  </div>
                )}

                <div className="ai-summary-section">
                  <h4>AI Analysis</h4>
                  <div className="ai-stats-list">
                    <div className="ai-stat-row">
                      <span className="ai-stat-label">Total Nodules</span>
                      <span className="ai-stat-value">{study.noduleCount}</span>
                    </div>
                    <div className="ai-stat-row">
                      <span className="ai-stat-label">High Risk</span>
                      <span className="ai-stat-value high">{nodules.filter(n => n.risk === 'high').length}</span>
                    </div>
                    <div className="ai-stat-row">
                      <span className="ai-stat-label">Medium Risk</span>
                      <span className="ai-stat-value medium">{nodules.filter(n => n.risk === 'medium').length}</span>
                    </div>
                    <div className="ai-stat-row">
                      <span className="ai-stat-label">Low Risk</span>
                      <span className="ai-stat-value low">{nodules.filter(n => n.risk === 'low').length}</span>
                    </div>
                    {nodules.length > 0 && (
                      <div className="ai-stat-row">
                        <span className="ai-stat-label">Largest</span>
                        <span className="ai-stat-value">
                          {Math.max(...nodules.map(n => parseFloat(n.size))).toFixed(1)} mm ({nodules.reduce((max, n) => parseFloat(n.size) > parseFloat(max.size) ? n : max, nodules[0]).location})
                        </span>
                      </div>
                    )}
                    <div className="ai-stat-row">
                      <span className="ai-stat-label">Total Slices</span>
                      <span className="ai-stat-value">{dicomFiles.length}</span>
                    </div>
                  </div>
                </div>
              </div>
        </div>

        {/* Center Panel - Viewer */}
        <div className="review-center-panel">
          <div className="viewer-toolbar">
            <div className="toolbar-section">
              <div className="toolbar-group">
                <button className="toolbar-btn" onClick={() => handleZoom(-0.25)}>−</button>
                <span className="zoom-display">{Math.round(zoom * 100)}%</span>
                <button className="toolbar-btn" onClick={() => handleZoom(0.25)}>+</button>
                <button className="toolbar-btn" onClick={handleResetView}>↺</button>
              </div>
              <div className="toolbar-divider" />
              <div className="toolbar-group window-presets">
                <span className="preset-label">Window:</span>
                {Object.entries(WINDOW_PRESETS).map(([key, preset]) => (
                  <button 
                    key={key}
                    className={`preset-btn ${activePreset === key ? 'active' : ''}`}
                    onClick={() => applyWindowPreset(key)}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="toolbar-section">
              <button className={`toolbar-btn ${showSegmentation ? 'active' : ''}`} onClick={() => setShowSegmentation(!showSegmentation)}>Seg</button>
              <button className={`toolbar-btn ${showHeatmap ? 'active' : ''}`} onClick={() => setShowHeatmap(!showHeatmap)}>Heat</button>
            </div>
          </div>

          <div className="viewer-wrapper">
            {dicomFiles.length > 0 ? (
              <>
                <div ref={viewerRef} className="dicom-viewer" tabIndex={0} style={{ width: '100%', height: '600px', minHeight: '600px' }} />
                {imageLoading && <div className="image-loading-overlay"><div className="loading-spinner small"></div></div>}
                
                {showSegmentation && nodules.map((nodule, i) => (
                  nodule.sliceIndex === currentImageIndex && (
                    <div key={nodule.id} className={`nodule-marker ${nodule.risk} ${selectedNodule === i ? 'selected' : ''}`}
                      style={{ left: `${nodule.coordinates.x}%`, top: `${nodule.coordinates.y}%` }}
                      onClick={() => goToNoduleSlice(nodule, i)}>
                      <span className="marker-label">#{nodule.id}</span>
                    </div>
                  )
                ))}

                {showHeatmap && <div className="heatmap-overlay"><div className="heatmap-gradient" /></div>}

                <div className="viewer-overlay">
                  <div className="overlay-top-left"><span>{study.patientName}</span><span>{study.patientID}</span></div>
                  <div className="overlay-top-right"><span>W:{windowLevel.ww}</span><span>L:{windowLevel.wc}</span></div>
                  <div className="overlay-bottom-left"><span>Slice: {currentImageIndex + 1}/{dicomFiles.length}</span></div>
                  <div className="overlay-bottom-right"><span>{Math.round(zoom * 100)}%</span></div>
                </div>
              </>
            ) : (
              <div className="viewer-placeholder">
                <div className="placeholder-content">
                  <span style={{ fontSize: '48px', marginBottom: '16px' }}>📷</span>
                  <h4>No DICOM Images Available</h4>
                  <p style={{ color: '#666', fontSize: '14px', marginTop: '8px' }}>
                    DICOM files were not uploaded for this study.<br/>
                    Please upload images from the New Study page.
                  </p>
                </div>
              </div>
            )}
          </div>

          {dicomFiles.length > 0 && (
            <div className="slice-navigation">
              <button className="slice-nav-btn" onClick={() => setCurrentImageIndex(Math.max(0, currentImageIndex - 1))} disabled={currentImageIndex === 0}>◀</button>
              <div className="slice-slider-container">
                <input type="range" min="0" max={dicomFiles.length - 1} value={currentImageIndex} onChange={handleSliderChange} className="slice-slider" />
                <span className="slice-info">{currentImageIndex + 1} / {dicomFiles.length}</span>
              </div>
              <button className="slice-nav-btn" onClick={() => setCurrentImageIndex(Math.min(dicomFiles.length - 1, currentImageIndex + 1))} disabled={currentImageIndex === dicomFiles.length - 1}>▶</button>
            </div>
          )}
          <div className="viewer-shortcuts"><span>Left Drag: Pan</span><span>Right Drag: W/L</span><span>Arrows: Slices</span></div>
        </div>

        {/* Right Panel - Nodules */}
        <div className="review-right-panel">
              <div className="panel-header"><h3>Nodules ({nodules.length})</h3></div>
              <div className="nodules-list">
                {nodules.length > 0 ? nodules.map((nodule, i) => (
                  <div key={nodule.id} className={`nodule-item ${selectedNodule === i ? 'selected' : ''} ${nodule.reviewed ? 'reviewed' : ''}`}
                    onClick={() => goToNoduleSlice(nodule, i)}>
                    <div className="nodule-item-header">
                      <span className="nodule-number">#{nodule.id}</span>
                      <span className={`risk-badge ${nodule.risk}`}>{nodule.risk.toUpperCase()}</span>
                    </div>
                    <div className="nodule-item-info">
                      <span>{nodule.location} • {nodule.size}mm</span>
                      <span className={`review-status ${nodule.reviewed ? 'done' : ''}`}>{nodule.reviewed ? '✓' : '○'}</span>
                    </div>
                  </div>
                )) : <div className="no-nodules">No nodules detected</div>}
              </div>

              {nodules.length > 0 && currentNodule && (
                <div className="nodule-details">
                  <div className="details-header">
                    <h4>Nodule #{currentNodule.id}</h4>
                    <span className={`risk-indicator ${currentNodule.risk}`}>{currentNodule.risk.toUpperCase()}</span>
                  </div>

                  <div className="details-content">
                    <div className="detail-section">
                      <div className="detail-row">
                        <label>Location</label>
                        <select value={currentNodule.location} onChange={(e) => updateNodule(selectedNodule, 'location', e.target.value)}>
                          <option value="RUL">RUL</option><option value="RML">RML</option><option value="RLL">RLL</option>
                          <option value="LUL">LUL</option><option value="LLL">LLL</option>
                        </select>
                      </div>
                      <div className="detail-row">
                        <label>Size (mm)</label>
                        <input type="number" value={currentNodule.size} onChange={(e) => updateNodule(selectedNodule, 'size', e.target.value)} step="0.1" />
                      </div>
                    </div>

                    <div className="detail-section">
                      <label>AI Malignancy</label>
                      <div className="probability-display">
                        <div className="probability-bar"><div className={`probability-fill ${currentNodule.risk}`} style={{ width: `${currentNodule.probability * 100}%` }} /></div>
                        <span>{(currentNodule.probability * 100).toFixed(0)}%</span>
                      </div>
                    </div>

                    <div className="detail-section xai-section">
                      <label>XAI Explanation</label>
                      <div className="xai-features">
                        {currentNodule.xaiExplanations?.map((exp, i) => (
                          <div key={i} className="xai-feature">
                            <span>{exp.feature}</span>
                            <div className="confidence-bar"><div style={{ width: `${exp.confidence * 100}%` }} /><span>{(exp.confidence * 100).toFixed(0)}%</span></div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="detail-section assessment-section">
                      <label>Assessment</label>
                      <div className="assessment-buttons">
                        <button className={`assessment-btn benign ${currentNodule.doctorAssessment === 'benign' ? 'active' : ''}`}
                          onClick={() => updateNodule(selectedNodule, 'doctorAssessment', 'benign')}>Benign</button>
                        <button className={`assessment-btn suspicious ${currentNodule.doctorAssessment === 'suspicious' ? 'active' : ''}`}
                          onClick={() => updateNodule(selectedNodule, 'doctorAssessment', 'suspicious')}>Suspicious</button>
                        <button className={`assessment-btn malignant ${currentNodule.doctorAssessment === 'malignant' ? 'active' : ''}`}
                          onClick={() => updateNodule(selectedNodule, 'doctorAssessment', 'malignant')}>Malignant</button>
                      </div>
                    </div>

                    <div className="detail-section">
                      <label>Notes</label>
                      <textarea value={currentNodule.notes} onChange={(e) => updateNodule(selectedNodule, 'notes', e.target.value)} placeholder="Clinical notes..." rows={2} />
                    </div>

                    <div className="detail-section">
                      <label className="checkbox-row">
                        <input type="checkbox" checked={currentNodule.includeInReport} onChange={(e) => updateNodule(selectedNodule, 'includeInReport', e.target.checked)} />
                        <span>Include in report</span>
                      </label>
                    </div>
                  </div>

                  <div className="nodule-navigation">
                    <button className="nav-btn" onClick={goToPrevNodule} disabled={selectedNodule === 0}>← Prev</button>
                    <span>{selectedNodule + 1}/{nodules.length}</span>
                    <button className="nav-btn primary" onClick={goToNextNodule} disabled={selectedNodule === nodules.length - 1}>Next →</button>
                  </div>
                  <button className="generate-report-btn" onClick={() => setShowReportModal(true)}>Save Report</button>
                </div>
              )}
        </div>
      </div>

      {/* Report Modal */}
      {showReportModal && (
        <div className="modal-overlay" onClick={() => setShowReportModal(false)}>
          <div className="report-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Save Report</h3><button className="close-btn" onClick={() => setShowReportModal(false)}>×</button></div>
            <div className="modal-body">
              <div className="report-summary">
                <h4>Report Summary</h4>
                <div className="summary-row"><span>Patient:</span><span>{study.patientName}</span></div>
                <div className="summary-row"><span>Study Date:</span><span>{study.studyDate}</span></div>
                <div className="summary-row"><span>Total Nodules:</span><span>{nodules.length}</span></div>
                <div className="summary-row"><span>Included:</span><span>{nodules.filter(n => n.includeInReport).length}</span></div>
                <div className="summary-row"><span>Reviewed:</span><span>{nodules.filter(n => n.reviewed).length}/{nodules.length}</span></div>
              </div>
              <div className="nodules-preview">
                <h4>Nodules to Include</h4>
                {nodules.filter(n => n.includeInReport).map(nodule => (
                  <div key={nodule.id} className="nodule-preview-item">
                    <span>#{nodule.id} - {nodule.location}</span><span>{nodule.size}mm</span>
                    <span className={`risk-tag ${nodule.risk}`}>{nodule.risk}</span>
                    {nodule.doctorAssessment && <span className={`assessment-tag ${nodule.doctorAssessment}`}>{nodule.doctorAssessment}</span>}
                  </div>
                ))}
              </div>
              <div className="report-options">
                <label className="checkbox-row"><input type="checkbox" defaultChecked /><span>Include AI analysis</span></label>
                <label className="checkbox-row"><input type="checkbox" defaultChecked /><span>Include XAI explanations</span></label>
                <label className="checkbox-row"><input type="checkbox" defaultChecked /><span>Include images</span></label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowReportModal(false)}>Cancel</button>
              <button className="generate-btn" onClick={generateReport} disabled={reportGenerating}>
                {reportGenerating ? <><span className="spinner"></span>Saving...</> : 'Save Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

