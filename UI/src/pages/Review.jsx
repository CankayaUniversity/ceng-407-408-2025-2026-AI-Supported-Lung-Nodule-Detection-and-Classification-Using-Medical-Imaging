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

const getCandidateSortScore = (candidate) => {
  const modelScore = Number(candidate?.coordinates?.score);
  if (Number.isFinite(modelScore)) return modelScore;

  const probability = Number(candidate?.probability);
  return Number.isFinite(probability) ? probability : 0;
};

const getCandidateLikelihood = (candidate, candidates) => {
  const probability = Number(candidate?.probability);
  return Number.isFinite(probability) ? Math.max(0, Math.min(100, probability * 100)) : 0;
};

const toBackendAssetUrl = (url) => {
  if (!url) return null;
  return url.startsWith('http') ? url : `http://localhost:3001${url}`;
};

const getClassificationLabel = (candidate) => {
  const label = candidate?.coordinates?.classificationLabel;
  if (label) return label;
  return getCandidateLikelihood(candidate) >= 50
    ? 'Positive nodule candidate'
    : 'Negative / likely false positive';
};

const getValidSliceIndex = (nodule, dicomFileCount = Number.POSITIVE_INFINITY) => {
  const candidates = [
    nodule?.sliceIndex,
    nodule?.slice_index,
    nodule?.coordinates?.sliceIndex,
    nodule?.coordinates?.displaySliceIndex,
    Number.isFinite(Number(nodule?.coordinates?.sliceNumber)) ? Number(nodule.coordinates.sliceNumber) - 1 : null,
    nodule?.coordinates?.modelSliceIndex,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric < dicomFileCount) {
      return numeric;
    }
  }

  return 0;
};

export default function Review(){
  const { studyId } = useParams();
  const navigate = useNavigate();
  const viewerRef = useRef(null);
  const viewerInitialized = useRef(false);
  const initialNoduleSliceDone = useRef(false);
  const dicomFilesRef = useRef([]);
  
  // Core state
  const [study, setStudy] = useState(null);
  const [dicomFiles, setDicomFiles] = useState([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [imageLoading, setImageLoading] = useState(false);
  
  // Viewer state
  const [viewerReady, setViewerReady] = useState(false);
  
  // Keep dicomFilesRef in sync
  useEffect(() => {
    dicomFilesRef.current = dicomFiles;
  }, [dicomFiles]);
  
  // Callback ref to initialize cornerstone when element is mounted
  const setViewerRef = useCallback((element) => {
    if (!element) {
      viewerRef.current = null;
      setViewerReady(false);
      return;
    }

    if (viewerRef.current === element) {
      return;
    }

    viewerRef.current = element;
    console.log('Viewer element mounted, initializing cornerstone...');

    try {
      cornerstone.enable(element);
      setViewerReady(true);
      console.log('Cornerstone enabled successfully');

      if (dicomFilesRef.current.length > 0) {
        const file = dicomFilesRef.current[0];
        const imageId = `wadouri:http://localhost:3001${file.file_path}`;
        cornerstone.loadAndCacheImage(imageId).then(image => {
          cornerstone.displayImage(element, image);
          cornerstone.resize(element, true);
          enableImageTools(element);
          console.log('First image displayed');
        }).catch(err => console.error('Error loading first image:', err));
      }
    } catch (e) {
      console.error('Error enabling cornerstone:', e);
    }
  }, []);
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
  const [markerPositions, setMarkerPositions] = useState({});
  const [segmentationOverlay, setSegmentationOverlay] = useState(null);
  const [heatmapOverlay, setHeatmapOverlay] = useState(null);
  
  // Report state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportGenerating, setReportGenerating] = useState(false);

  // Debug: Log state changes
  useEffect(() => {
    console.log('State update - viewerReady:', viewerReady, 'dicomFiles:', dicomFiles.length, 'viewerRef:', !!viewerRef.current);
  }, [viewerReady, dicomFiles.length]);

  const getNoduleImagePoint = useCallback((nodule, image) => {
    const coords = nodule?.coordinates || {};
    const pixelX = Number(coords.pixelX);
    const pixelY = Number(coords.pixelY);

    if (Number.isFinite(pixelX) && Number.isFinite(pixelY)) {
      return { x: pixelX, y: pixelY };
    }

    const x = Number(coords.x);
    const y = Number(coords.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    const width = image?.columns || image?.width || 512;
    const height = image?.rows || image?.height || 512;

    // New results store x/y as percent for legacy UI compatibility.
    // Older rows may have stored raw pixel coordinates in x/y.
    if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
      return { x: (x / 100) * width, y: (y / 100) * height };
    }

    return { x, y };
  }, []);

  const updateMarkerPositions = useCallback(() => {
    const element = viewerRef.current;
    if (!element || nodules.length === 0) {
      setMarkerPositions({});
      return;
    }

    try {
      const enabledElement = cornerstone.getEnabledElement(element);
      const image = enabledElement?.image;
      if (!image) return;
      const wrapperRect = element.parentElement?.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const elementOffset = wrapperRect
        ? {
            x: elementRect.left - wrapperRect.left,
            y: elementRect.top - wrapperRect.top
          }
        : { x: 0, y: 0 };

      const nextPositions = {};
      nodules.forEach((nodule, index) => {
        if (getValidSliceIndex(nodule, dicomFiles.length) !== currentImageIndex) return;

        const imagePoint = getNoduleImagePoint(nodule, image);
        if (!imagePoint) return;

        const canvasPoint = cornerstone.pixelToCanvas(element, imagePoint);
        nextPositions[nodule.id || index] = {
          left: `${canvasPoint.x + elementOffset.x}px`,
          top: `${canvasPoint.y + elementOffset.y}px`
        };
      });

      setMarkerPositions(nextPositions);

      const overlayNodule =
        (getValidSliceIndex(nodules[selectedNodule], dicomFiles.length) === currentImageIndex && nodules[selectedNodule]?.coordinates?.overlayUrl
          ? nodules[selectedNodule]
          : nodules.find(nodule => getValidSliceIndex(nodule, dicomFiles.length) === currentImageIndex && nodule.coordinates?.overlayUrl));
      const heatmapNodule =
        (getValidSliceIndex(nodules[selectedNodule], dicomFiles.length) === currentImageIndex && nodules[selectedNodule]?.coordinates?.heatmapUrl
          ? nodules[selectedNodule]
          : nodules.find(nodule => getValidSliceIndex(nodule, dicomFiles.length) === currentImageIndex && nodule.coordinates?.heatmapUrl));

      const imageStyle = () => {
        const topLeft = cornerstone.pixelToCanvas(element, { x: 0, y: 0 });
        const bottomRight = cornerstone.pixelToCanvas(element, {
          x: image.columns || image.width || 512,
          y: image.rows || image.height || 512
        });
        const left = Math.min(topLeft.x, bottomRight.x);
        const top = Math.min(topLeft.y, bottomRight.y);
        const width = Math.abs(bottomRight.x - topLeft.x);
        const height = Math.abs(bottomRight.y - topLeft.y);
        return {
          left: `${left + elementOffset.x}px`,
          top: `${top + elementOffset.y}px`,
          width: `${width}px`,
          height: `${height}px`
        };
      };

      if (overlayNodule?.coordinates?.overlayUrl) {
        const overlayUrl = overlayNodule.coordinates.overlayUrl.startsWith('http')
          ? overlayNodule.coordinates.overlayUrl
          : `http://localhost:3001${overlayNodule.coordinates.overlayUrl}`;

        setSegmentationOverlay({
          src: overlayUrl,
          style: imageStyle()
        });
      } else {
        setSegmentationOverlay(null);
      }

      if (heatmapNodule?.coordinates?.heatmapUrl) {
        const heatmapUrl = heatmapNodule.coordinates.heatmapUrl.startsWith('http')
          ? heatmapNodule.coordinates.heatmapUrl
          : `http://localhost:3001${heatmapNodule.coordinates.heatmapUrl}`;

        setHeatmapOverlay({
          src: heatmapUrl,
          style: imageStyle()
        });
      } else {
        setHeatmapOverlay(null);
      }
    } catch (error) {
      console.error('Error updating nodule marker positions:', error);
    }
  }, [currentImageIndex, getNoduleImagePoint, nodules, selectedNodule]);

  const scheduleOverlayUpdate = useCallback(() => {
    requestAnimationFrame(updateMarkerPositions);
    setTimeout(updateMarkerPositions, 60);
    setTimeout(updateMarkerPositions, 180);
  }, [updateMarkerPositions]);

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

  useEffect(() => {
    const element = viewerRef.current;
    if (!element || !viewerReady) return;

    const handleImageRendered = () => scheduleOverlayUpdate();
    element.addEventListener('cornerstoneimagerendered', handleImageRendered);
    window.addEventListener('resize', handleImageRendered);
    scheduleOverlayUpdate();

    return () => {
      element.removeEventListener('cornerstoneimagerendered', handleImageRendered);
      window.removeEventListener('resize', handleImageRendered);
    };
  }, [scheduleOverlayUpdate, viewerReady]);

  // Also load when viewerReady changes
  useEffect(() => {
    if (viewerReady && dicomFiles.length > 0 && !viewerInitialized.current) {
      viewerInitialized.current = true;
      
      // Load and display the first image
      const displayFirstImage = async () => {
        try {
          const file = dicomFiles[0];
          const imageId = `wadouri:http://localhost:3001${file.file_path}`;
          
          console.log('Loading first image:', imageId);
          const image = await cornerstone.loadAndCacheImage(imageId);
          
          if (viewerRef.current) {
            cornerstone.displayImage(viewerRef.current, image);
            cornerstone.resize(viewerRef.current, true);
            
            // Apply window preset
            const viewport = cornerstone.getViewport(viewerRef.current);
            if (viewport) {
              viewport.voi.windowWidth = 1500;
              viewport.voi.windowCenter = -600;
              cornerstone.setViewport(viewerRef.current, viewport);
            }
            
            enableImageTools(viewerRef.current);
            console.log('First image displayed successfully');
          }
        } catch (err) {
          console.error('Error displaying first image:', err);
        }
      };
      
      // Small delay then display
      setTimeout(displayFirstImage, 100);
    }
  }, [viewerReady, dicomFiles.length]);

  // Reset initialization flag when study changes
  useEffect(() => {
    viewerInitialized.current = false;
    initialNoduleSliceDone.current = false;
    setViewerReady(false);
    setCurrentImageIndex(0);
  }, [studyId]);

  // Initialize cornerstone when dicomFiles are loaded
  useEffect(() => {
    if (!viewerRef.current || dicomFiles.length === 0) return;
    
    let timeoutId;
    let retryCount = 0;
    const maxRetries = 30;
    
    // Helper function to load first image immediately after cornerstone is enabled
    const loadFirstImage = async (element) => {
      try {
        const file = dicomFiles[0];
        if (!file) return;
        const imageId = `wadouri:http://localhost:3001${file.file_path}`;
        const image = await cornerstone.loadAndCacheImage(imageId);
        cornerstone.displayImage(element, image);
        cornerstone.resize(element, true);
        console.log('First image loaded successfully');
      } catch (err) {
        console.error('Error loading first image:', err);
      }
    };
    
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
          // Load first image immediately after enabling
          loadFirstImage(element);
        } catch (e) {
          try {
            cornerstone.enable(element);
            console.log('Cornerstone enabled successfully, element:', element);
            setViewerReady(true);
            // Load first image immediately after enabling
            loadFirstImage(element);
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
        let sortedFiles = [];
        
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
          hasPreviousCT: false
        });
        
        if (studyData.dicomFiles && studyData.dicomFiles.length > 0) {
          console.log('DICOM files found:', studyData.dicomFiles.length);
          sortedFiles = [...studyData.dicomFiles].sort((a, b) => 
            a.file_name.localeCompare(b.file_name, undefined, { numeric: true })
          );
          setDicomFiles(sortedFiles);
          console.log('First DICOM file:', sortedFiles[0]);
        } else {
          console.log('No DICOM files found for this study');
          setDicomFiles([]);
        }

        // Fetch real nodules from database (from AI analysis)
        console.log('Fetching nodules from database...');
        const nodulesList = studyData.nodules || [];
        
        const formattedNodules = nodulesList.map((nodule, index) => {
          const risk = nodule.risk_level || 'medium';
          const location = nodule.location || 'AI';
          
          return {
            id: nodule.id || index + 1,
            nodule_number: nodule.nodule_number || index + 1,
            location: location,
            locationFull: getLocationFullName(location),
            size: (nodule.size_mm || 0).toFixed(1),
            probability: (nodule.probability || 0).toFixed(2),
            risk: risk,
            sliceIndex: getValidSliceIndex(nodule, sortedFiles.length || Number.POSITIVE_INFINITY),
            reviewed: nodule.reviewed || false,
            includeInReport: nodule.include_in_report !== false,
            notes: nodule.notes || '',
            doctorAssessment: nodule.doctor_assessment || '',
            xaiExplanations: [],
            coordinates: nodule.coordinates ? JSON.parse(nodule.coordinates) : { x: 0, y: 0 }
          };
        }).sort((a, b) => getCandidateSortScore(b) - getCandidateSortScore(a))
          .map((nodule, index) => ({
            ...nodule,
            displayRank: index + 1
          }));
        
        setNodules(formattedNodules);
        if (formattedNodules.length === 0) {
          setSelectedNodule(0);
        }
        if (!initialNoduleSliceDone.current && formattedNodules.length > 0) {
          initialNoduleSliceDone.current = true;
          setSelectedNodule(0);
          const firstSlice = getValidSliceIndex(formattedNodules[0], sortedFiles.length);
          if (Number.isInteger(firstSlice) && firstSlice >= 0 && firstSlice < sortedFiles.length) {
            setCurrentImageIndex(firstSlice);
          }
        }
        
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
      'LLL': 'Left Lower Lobe',
      'AI': 'Model Candidate'
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
      cornerstone.resize(viewerRef.current, true);
      
      // Apply current viewport settings (preserve zoom and window/level between slices)
      const viewport = cornerstone.getViewport(viewerRef.current);
      if (viewport) {
        viewport.voi.windowWidth = windowLevel.ww;
        viewport.voi.windowCenter = windowLevel.wc;
        viewport.scale = zoom;
        cornerstone.setViewport(viewerRef.current, viewport);
      }
      
      enableImageTools(viewerRef.current);
      scheduleOverlayUpdate();
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
        scheduleOverlayUpdate();
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
          scheduleOverlayUpdate();
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
        scheduleOverlayUpdate();
      }
    }
  };

  const goToNoduleSlice = (nodule, index) => {
    const targetSliceIndex = getValidSliceIndex(nodule, dicomFiles.length);
    setCurrentImageIndex(targetSliceIndex);
    setSelectedNodule(index);
    updateNodule(index, 'reviewed', true);

    if (viewerRef.current && dicomFiles[targetSliceIndex]) {
      loadDicomImage(targetSliceIndex);
    } else {
      scheduleOverlayUpdate();
    }
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
      let nlpAnalysis = null;
      try {
        const nlpResponse = await fetch(`${API_URL}/nlp/analyze-note`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            study_id: studyId,
            patient_age: study.age,
            patient_gender: study.gender,
            clinical_note: study.clinicalInfo || '',
            description: study.description || '',
            nodules: nodules.map((nodule) => ({
              id: nodule.id,
              risk: nodule.risk,
              notes: nodule.notes,
              doctorAssessment: nodule.doctorAssessment,
              includeInReport: nodule.includeInReport,
            })),
          })
        });

        if (nlpResponse.ok) {
          const nlpResult = await nlpResponse.json();
          nlpAnalysis = nlpResult.analysis || null;
        }
      } catch (nlpError) {
        console.error('Error running report NLP analysis:', nlpError);
      }

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
          nlpAnalysis,
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
                      <span className="ai-stat-label">AI Candidates</span>
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
                        <span className="ai-stat-label">Largest Eq. Diameter</span>
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

          <div className={`viewer-wrapper ${showHeatmap ? 'heat-active' : ''}`}>
            {dicomFiles.length > 0 ? (
              <>
                <div 
                  key={`viewer-${studyId}`}
                  ref={setViewerRef} 
                  className="dicom-viewer" 
                  tabIndex={0} 
                  style={{ width: '100%', height: '600px', minHeight: '600px', background: '#000' }} 
                />
                {imageLoading && <div className="image-loading-overlay"><div className="loading-spinner small"></div></div>}

                {showSegmentation && segmentationOverlay && (
                  <img
                    className="segmentation-overlay-image"
                    src={segmentationOverlay.src}
                    style={segmentationOverlay.style}
                    onError={() => setSegmentationOverlay(null)}
                    alt=""
                  />
                )}
                
                {showHeatmap && heatmapOverlay && (
                  <img
                    className="heatmap-overlay-image"
                    src={heatmapOverlay.src}
                    style={heatmapOverlay.style}
                    onError={() => setHeatmapOverlay(null)}
                    alt=""
                  />
                )}

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
                  <span style={{ fontSize: '48px', marginBottom: '16px' }}>No Image</span>
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
              <button className="slice-nav-btn" onClick={() => setCurrentImageIndex(Math.max(0, currentImageIndex - 1))} disabled={currentImageIndex === 0}>&lt;</button>
              <div className="slice-slider-container">
                <input type="range" min="0" max={dicomFiles.length - 1} value={currentImageIndex} onChange={handleSliderChange} className="slice-slider" />
                <span className="slice-info">{currentImageIndex + 1} / {dicomFiles.length}</span>
              </div>
              <button className="slice-nav-btn" onClick={() => setCurrentImageIndex(Math.min(dicomFiles.length - 1, currentImageIndex + 1))} disabled={currentImageIndex === dicomFiles.length - 1}>&gt;</button>
            </div>
          )}
          <div className="viewer-shortcuts"><span>Left Drag: Pan</span><span>Right Drag: W/L</span><span>Arrows: Slices</span></div>
        </div>

        {/* Right Panel - Nodules */}
        <div className="review-right-panel">
              <div className="panel-header"><h3>AI Candidates ({nodules.length})</h3></div>
              <div className="nodules-list">
                {nodules.length > 0 ? nodules.map((nodule, i) => (
                  <div key={nodule.id} className={`nodule-item ${selectedNodule === i ? 'selected' : ''} ${nodule.reviewed ? 'reviewed' : ''}`}
                    onClick={() => goToNoduleSlice(nodule, i)}>
                    <div className="nodule-item-header">
                      <span className="nodule-number">#{nodule.displayRank || i + 1}</span>
                      <span className={`risk-badge ${nodule.risk}`}>{getCandidateLikelihood(nodule, nodules).toFixed(0)}%</span>
                    </div>
                    <div className="nodule-item-info">
                      <span>Slice {getValidSliceIndex(nodule, dicomFiles.length) + 1} - {nodule.size} mm eq. dia.</span>
                      <span>{getCandidateLikelihood(nodule, nodules).toFixed(0)}% likelihood</span>
                    </div>
                  </div>
                )) : <div className="no-nodules">No AI candidates detected</div>}
              </div>

              {nodules.length > 0 && currentNodule && (
                <div className="nodule-details">
                  <div className="details-header">
                    <h4>AI Candidate #{currentNodule.displayRank || selectedNodule + 1}</h4>
                    <span className={`risk-indicator ${currentNodule.risk}`}>{getCandidateLikelihood(currentNodule, nodules).toFixed(0)}%</span>
                  </div>

                  <div className="details-content">
                    <div className="detail-section">
                      <div className="detail-row">
                        <label>Location</label>
                        <select value={currentNodule.location} onChange={(e) => updateNodule(selectedNodule, 'location', e.target.value)}>
                          <option value="AI">Model Candidate</option>
                          <option value="RUL">RUL</option><option value="RML">RML</option><option value="RLL">RLL</option>
                          <option value="LUL">LUL</option><option value="LLL">LLL</option>
                        </select>
                      </div>
                      <div className="detail-row">
                        <label>Equivalent Diameter (mm)</label>
                        <input type="number" value={currentNodule.size} onChange={(e) => updateNodule(selectedNodule, 'size', e.target.value)} step="0.1" />
                      </div>
                    </div>

                    <div className="detail-section">
                      <label>Nodule Likelihood</label>
                      <div className="probability-display">
                        <div className="probability-bar"><div className={`probability-fill ${currentNodule.risk}`} style={{ width: `${getCandidateLikelihood(currentNodule, nodules)}%` }} /></div>
                        <span>{getCandidateLikelihood(currentNodule, nodules).toFixed(0)}%</span>
                      </div>
                      {currentNodule.coordinates?.classificationProbability && (
                        <div className="classification-result">
                          <strong>{getClassificationLabel(currentNodule)}</strong>
                          <span>Classifier probability: {Number(currentNodule.coordinates.classificationProbability).toFixed(3)}</span>
                        </div>
                      )}
                    </div>

                    {(currentNodule.coordinates?.classifierPanelsUrl || currentNodule.coordinates?.classifierGradcamUrl) && (
                      <div className="detail-section classifier-explanation-section">
                        <label>Classifier Explanation</label>
                        {currentNodule.coordinates?.classifierPanelsUrl ? (
                          <img
                            className="classifier-panels-image"
                            src={toBackendAssetUrl(currentNodule.coordinates.classifierPanelsUrl)}
                            alt="Classifier explanation panels"
                          />
                        ) : (
                          <img
                            className="classifier-crop-image"
                            src={toBackendAssetUrl(currentNodule.coordinates.classifierGradcamUrl)}
                            alt="Classifier explanation crop"
                          />
                        )}
                        <p className="research-note">
                          Model output is for research/demo purposes only and must not be used as a clinical diagnosis.
                        </p>
                      </div>
                    )}

                    {currentNodule.xaiExplanations?.length > 0 && (
                      <div className="detail-section xai-section">
                        <label>XAI Explanation</label>
                        <div className="xai-features">
                          {currentNodule.xaiExplanations.map((exp, i) => (
                            <div key={i} className="xai-feature">
                              <span>{exp.feature}</span>
                              <div className="confidence-bar"><div style={{ width: `${exp.confidence * 100}%` }} /><span>{(exp.confidence * 100).toFixed(0)}%</span></div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

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
                <div className="summary-row"><span>AI Candidates:</span><span>{nodules.length}</span></div>
                <div className="summary-row"><span>Included:</span><span>{nodules.filter(n => n.includeInReport).length}</span></div>
                <div className="summary-row"><span>Reviewed:</span><span>{nodules.filter(n => n.reviewed).length}/{nodules.length}</span></div>
              </div>
              <div className="nodules-preview">
                <h4>AI Candidates to Include</h4>
                {nodules.filter(n => n.includeInReport).map(nodule => (
                  <div key={nodule.id} className="nodule-preview-item">
                    <span>#{nodule.displayRank || nodule.id} - {nodule.location}</span><span>{getCandidateLikelihood(nodule, nodules).toFixed(0)}%</span>
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

