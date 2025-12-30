import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './NewStudy.css';
import { patientAPI, studyAPI, dicomAPI } from '../services/api';
import { parseDicomMetadata, loadDicomFromFile, cornerstone } from '../utils/dicomUtils';

function NewStudy() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const previewRef = useRef(null);
  const [formData, setFormData] = useState({
    patientID: '',
    nameSurname: '',
    age: '',
    gender: '',
    clinicalNote: ''
  });
  const [dicomFiles, setDicomFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [studyId, setStudyId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);
  const [previewLoaded, setPreviewLoaded] = useState(false);

  const handleInputChange = (e) => {
    setFormData({...formData, [e.target.name]: e.target.value});
  };

  const processFiles = async (files) => {
    // Filter only DICOM files
    const validFiles = files.filter(file => 
      file.name.toLowerCase().endsWith('.dcm') || 
      file.name.toLowerCase().endsWith('.dicom') ||
      file.type === 'application/dicom'
    );

    if (validFiles.length === 0) {
      alert('Please select valid DICOM files (.dcm or .dicom)');
      return;
    }

    // Sort files by name for proper slice ordering
    validFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    
    setDicomFiles(validFiles);
    setSelectedPreviewIndex(0);
    setPreviewLoaded(false);
    
    // Parse first file to extract patient info
    if (validFiles.length > 0) {
      try {
        const metadata = await parseDicomMetadata(validFiles[0]);
        if (metadata.patientName || metadata.patientID) {
          setFormData(prev => ({
            ...prev,
            patientID: metadata.patientID || prev.patientID,
            nameSurname: metadata.patientName || prev.nameSurname,
          }));
        }
        // Load preview of first image
        loadPreviewImage(validFiles[0]);
      } catch (error) {
        console.error('Error parsing DICOM metadata:', error);
      }
    }
  };

  const loadPreviewImage = async (file) => {
    if (!previewRef.current) return;
    
    try {
      const { imageId, image } = await loadDicomFromFile(file);
      cornerstone.enable(previewRef.current);
      cornerstone.displayImage(previewRef.current, image);
      setPreviewLoaded(true);
    } catch (error) {
      console.error('Error loading preview:', error);
      setPreviewLoaded(false);
    }
  };

  const handleDicomUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    await processFiles(files);
  };

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    const files = [];

    // Handle folder drops
    const processEntry = async (entry) => {
      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file(file => {
            files.push(file);
            resolve();
          });
        });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        return new Promise((resolve) => {
          reader.readEntries(async (entries) => {
            for (const subEntry of entries) {
              await processEntry(subEntry);
            }
            resolve();
          });
        });
      }
    };

    if (items) {
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) {
          entries.push(entry);
        }
      }
      for (const entry of entries) {
        await processEntry(entry);
      }
    } else {
      // Fallback for browsers that don't support webkitGetAsEntry
      for (const file of e.dataTransfer.files) {
        files.push(file);
      }
    }

    if (files.length > 0) {
      await processFiles(files);
    }
  }, []);

  const handlePreviewNavigation = async (direction) => {
    if (dicomFiles.length === 0) return;
    
    let newIndex = selectedPreviewIndex + direction;
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= dicomFiles.length) newIndex = dicomFiles.length - 1;
    
    setSelectedPreviewIndex(newIndex);
    await loadPreviewImage(dicomFiles[newIndex]);
  };

  const clearFiles = () => {
    setDicomFiles([]);
    setSelectedPreviewIndex(0);
    setPreviewLoaded(false);
    if (previewRef.current) {
      try {
        cornerstone.disable(previewRef.current);
      } catch (e) {}
    }
  };

  const savePatientAndStudy = async () => {
    try {
      // Validate form
      if (!formData.patientID || !formData.nameSurname) {
        alert('Please fill in Patient ID and Name');
        return null;
      }

      // DICOM files are optional but recommended
      if (dicomFiles.length === 0) {
        const proceed = confirm('No DICOM files selected. Continue without images?\n\nNote: You will not be able to view images in the Review page.');
        if (!proceed) {
          return null;
        }
      }

      // Create patient
      const patientData = {
        patient_id: formData.patientID,
        name: formData.nameSurname,
        age: parseInt(formData.age) || null,
        gender: formData.gender || null
      };

      try {
        console.log('Creating patient:', patientData);
        console.log('API URL:', 'http://localhost:3001/api/patients');
        const response = await patientAPI.create(patientData);
        console.log('Patient created:', response.data);
      } catch (error) {
        // Patient might already exist, that's okay
        console.log('Patient creation error (might already exist):', error.response?.data || error.message);
        console.log('Full error:', error);
        // If error is not "already exists", throw it
        if (error.response?.status !== 500 && !error.message.includes('UNIQUE constraint')) {
          throw error;
        }
      }

      // Create study
      const newStudyId = `STD-${Date.now()}`;
      const studyData = {
        study_id: newStudyId,
        patient_id: formData.patientID,
        study_date: new Date().toISOString().split('T')[0],
        description: formData.clinicalNote || 'CT Chest Study'
      };

      console.log('Creating study:', studyData);
      const studyResponse = await studyAPI.create(studyData);
      console.log('Study created:', studyResponse.data);
      
      setStudyId(newStudyId);

      return newStudyId;
    } catch (error) {
      console.error('Error saving patient/study:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
      alert(`Failed to save patient/study information: ${errorMsg}\n\nPlease check:\n1. Backend server is running (http://localhost:3001)\n2. Patient ID and Name are filled\n3. Browser console for details`);
      return null;
    }
  };

  const startAnalysis = async () => {
    const newStudyId = await savePatientAndStudy();
    if (!newStudyId) return;

    setIsProcessing(true);
    setProgress(0);

    try {
      // Upload DICOM files if available
      setProgress(10);
      if (dicomFiles.length > 0) {
        console.log('Uploading DICOM files...', dicomFiles.length);
        await dicomAPI.uploadFiles(newStudyId, dicomFiles);
        console.log('DICOM files uploaded successfully');
      } else {
        console.log('No DICOM files to upload');
      }
      setProgress(40);

      // Simulate AI analysis
      await new Promise(resolve => setTimeout(resolve, 1000));
      setProgress(70);

      await new Promise(resolve => setTimeout(resolve, 1000));
      setProgress(90);

      // Update study status
      const noduleCount = Math.floor(Math.random() * 5) + 1; // Mock nodule count
      await studyAPI.updateStatus(newStudyId, 'completed', noduleCount);
      
      setProgress(100);
    } catch (error) {
      console.error('Error during analysis:', error);
      alert('Failed to process study. Please try again.');
      setIsProcessing(false);
      setProgress(0);
    }
  };

  const submitResults = () => {
    if (studyId) {
      navigate(`/review/${studyId}`);
    }
  };

  return (
    <div className="worklist">
      <div className="worklist-header">
        <h2>New Study</h2>
        <p>Upload DICOM files and start AI-powered nodule detection analysis</p>
      </div>

      <div className="new-study-grid">
        {/* Left Column - Patient Info & Upload */}
        <div className="new-study-left">
          <div className="dashboard-section">
            <h3>Patient Information</h3>
            <div className="patient-form-grid">
              <div className="form-field">
                <label>Patient ID *</label>
                <input 
                  name="patientID" 
                  placeholder="e.g., P-12345" 
                  value={formData.patientID}
                  onChange={handleInputChange}
                  className="new-study-input"
                />
              </div>
              <div className="form-field">
                <label>Full Name *</label>
                <input 
                  name="nameSurname" 
                  placeholder="e.g., John Doe" 
                  value={formData.nameSurname}
                  onChange={handleInputChange}
                  className="new-study-input"
                />
              </div>
              <div className="form-field">
                <label>Age</label>
                <input 
                  name="age" 
                  type="number"
                  placeholder="e.g., 45" 
                  value={formData.age}
                  onChange={handleInputChange}
                  className="new-study-input"
                />
              </div>
              <div className="form-field">
                <label>Gender</label>
                <select 
                  name="gender" 
                  value={formData.gender}
                  onChange={handleInputChange}
                  className="new-study-input"
                >
                  <option value="">Select Gender</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                </select>
              </div>
              <div className="form-field full-width">
                <label>Clinical Notes</label>
                <textarea 
                  name="clinicalNote" 
                  placeholder="Enter any relevant clinical notes or observations..." 
                  value={formData.clinicalNote}
                  onChange={handleInputChange}
                  className="new-study-input textarea"
                  rows={3}
                />
              </div>
            </div>
          </div>

          <div className="dashboard-section">
            <h3>DICOM File Upload</h3>
            <div 
              className={`drop-zone ${isDragging ? 'dragging' : ''} ${dicomFiles.length > 0 ? 'has-files' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                ref={fileInputRef}
                type="file" 
                accept=".dcm,.dicom,application/dicom"
                multiple
                onChange={handleDicomUpload}
                style={{display: 'none'}}
              />
              <input 
                ref={folderInputRef}
                type="file" 
                webkitdirectory=""
                directory=""
                multiple
                onChange={handleDicomUpload}
                style={{display: 'none'}}
              />
              
              {dicomFiles.length === 0 ? (
                <>
                  <div className="drop-icon"></div>
                  <h4>Drag & Drop DICOM Files Here</h4>
                  <p>or click to browse files</p>
                  <div className="drop-actions">
                    <button 
                      type="button"
                      className="browse-btn"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    >
                      Select Files
                    </button>
                    <button 
                      type="button"
                      className="browse-btn secondary"
                      onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}
                    >
                      Select Folder
                    </button>
                  </div>
                  <p className="drop-hint">Supports .dcm and .dicom files</p>
                </>
              ) : (
                <div className="files-selected" onClick={(e) => e.stopPropagation()}>
                  <div className="files-icon">✓</div>
                  <h4>{dicomFiles.length} DICOM File{dicomFiles.length > 1 ? 's' : ''} Selected</h4>
                  <p>Ready for AI analysis</p>
                  <div className="file-list">
                    {dicomFiles.slice(0, 5).map((file, i) => (
                      <span key={i} className="file-tag">{file.name}</span>
                    ))}
                    {dicomFiles.length > 5 && (
                      <span className="file-tag more">+{dicomFiles.length - 5} more</span>
                    )}
                  </div>
                  <button 
                    type="button" 
                    className="clear-btn"
                    onClick={clearFiles}
                  >
                    Clear Selection
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Analysis Section */}
          <div className="dashboard-section">
            <h3>AI Analysis</h3>
            <div className="analysis-controls">
              <button 
                className="start-analysis-btn" 
                onClick={startAnalysis} 
                disabled={isProcessing || (!formData.patientID || !formData.nameSurname)}
              >
                {isProcessing ? (
                  <>
                    <span className="spinner"></span>
                    Processing... ({progress}%)
                  </>
                ) : (
                  <>Start AI Analysis</>
                )}
              </button>
              
              {(!formData.patientID || !formData.nameSurname) && !isProcessing && (
                <p className="analysis-hint">Fill in Patient ID and Name to start analysis</p>
              )}
            </div>

            {isProcessing && (
              <div className="progress-section">
                <div className="progress-bar-container">
                  <div className="progress-bar" style={{width: `${progress}%`}} />
                </div>
                <div className="progress-steps">
                  <div className={`step ${progress >= 10 ? 'active' : ''}`}>
                    <span className="step-icon">{progress >= 40 ? '✓' : '1'}</span>
                    <span>Uploading</span>
                  </div>
                  <div className={`step ${progress >= 40 ? 'active' : ''}`}>
                    <span className="step-icon">{progress >= 70 ? '✓' : '2'}</span>
                    <span>Processing</span>
                  </div>
                  <div className={`step ${progress >= 70 ? 'active' : ''}`}>
                    <span className="step-icon">{progress >= 90 ? '✓' : '3'}</span>
                    <span>AI Analysis</span>
                  </div>
                  <div className={`step ${progress >= 100 ? 'active' : ''}`}>
                    <span className="step-icon">{progress >= 100 ? '✓' : '4'}</span>
                    <span>Complete</span>
                  </div>
                </div>
              </div>
            )}

            {progress === 100 && (
              <button className="view-results-btn" onClick={submitResults}>
                View Results in Review Page
              </button>
            )}
          </div>
        </div>

        {/* Right Column - DICOM Preview */}
        <div className="new-study-right">
          <div className="dashboard-section preview-section">
            <h3>DICOM Preview</h3>
            <div className="preview-container">
              {dicomFiles.length > 0 ? (
                <>
                  <div 
                    ref={previewRef}
                    className="dicom-preview-viewer"
                  />
                  {!previewLoaded && (
                    <div className="preview-loading">
                      <span className="spinner"></span>
                      <p>Loading preview...</p>
                    </div>
                  )}
                  <div className="preview-controls">
                    <button 
                      onClick={() => handlePreviewNavigation(-1)} 
                      disabled={selectedPreviewIndex === 0}
                      className="preview-nav-btn"
                    >
                      ← Prev
                    </button>
                    <span className="preview-counter">
                      {selectedPreviewIndex + 1} / {dicomFiles.length}
                    </span>
                    <button 
                      onClick={() => handlePreviewNavigation(1)} 
                      disabled={selectedPreviewIndex === dicomFiles.length - 1}
                      className="preview-nav-btn"
                    >
                      Next →
                    </button>
                  </div>
                  <div className="preview-info">
                    <p className="preview-filename">{dicomFiles[selectedPreviewIndex]?.name}</p>
                  </div>
                </>
              ) : (
                <div className="preview-placeholder">
                  <div className="placeholder-icon"></div>
                  <h4>No Images Selected</h4>
                  <p>Upload DICOM files to see a preview</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NewStudy;
