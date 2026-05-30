import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './Review.css';
import { studyAPI, noduleAPI, aiAPI } from '../services/api';
import { cornerstone, displayDicomImage, enableImageTools, resetViewport, cornerstoneWADOImageLoader } from '../utils/dicomUtils';
import NoduleViewer3D from '../components/NoduleViewer3D';

const API_URL = 'http://localhost:3001/api';

// Window presets for CT imaging
const WINDOW_PRESETS = {
  lung: { ww: 1500, wc: -600, name: 'Lung' },
  mediastinum: { ww: 350, wc: 50, name: 'Mediastinum' },
  bone: { ww: 2000, wc: 500, name: 'Bone' },
  soft: { ww: 400, wc: 40, name: 'Soft Tissue' }
};

// Fallback XAI templates (used when model concept scores are unavailable)
const XAI_EXPLANATIONS = {
  high: [
    { feature: 'Spiculation', confidence: 0.89 },
    { feature: 'Margin', confidence: 0.82 },
    { feature: 'Texture', confidence: 0.78 },
    { feature: 'Lobulation', confidence: 0.75 }
  ],
  medium: [
    { feature: 'Lobulation', confidence: 0.72 },
    { feature: 'Margin', confidence: 0.68 },
    { feature: 'Texture', confidence: 0.65 }
  ],
  low: [
    { feature: 'Calcification', confidence: 0.85 },
    { feature: 'Sphericity', confidence: 0.72 },
    { feature: 'Subtlety', confidence: 0.68 }
  ]
};

// Human-readable concept labels for XAI display
const CONCEPT_LABELS = {
  subtlety: 'Subtlety',
  internalStructure: 'Internal Structure',
  calcification: 'Calcification',
  sphericity: 'Sphericity',
  margin: 'Margin Sharpness',
  lobulation: 'Lobulation',
  spiculation: 'Spiculation',
  texture: 'Texture',
};

// ── Segresnet candidate utility helpers ──────────────────────────────────────

const getValidSliceIndex = (nodule, dicomFileCount = Number.POSITIVE_INFINITY) => {
  const candidates = [
    nodule?.sliceIndex,
    nodule?.slice_index,
    nodule?.coordinates?.sliceIndex,
    nodule?.coordinates?.displaySliceIndex,
    Number.isFinite(Number(nodule?.coordinates?.sliceNumber)) ? Number(nodule.coordinates.sliceNumber) - 1 : null,
    nodule?.coordinates?.modelSliceIndex,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isInteger(n) && n >= 0 && n < dicomFileCount) return n;
  }
  return 0;
};

const clampPercent = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v * 100)) : 0);

const getSegmentationProbability = (n) => {
  const sp = Number(n?.coordinates?.segmentationProbability);
  return Number.isFinite(sp) ? sp : Number.isFinite(Number(n?.probability)) ? Number(n.probability) : 0;
};

const getClassifierProbability = (n) => {
  const cp = Number(n?.coordinates?.classificationProbability);
  return Number.isFinite(cp) ? cp : null;
};

const getCandidateRisk = (n) => {
  const cp = getClassifierProbability(n);
  if (cp === null) return (n?.risk || 'medium').toLowerCase();
  const avg = (getSegmentationProbability(n) + cp) / 2;
  if (cp < 0.4) return 'low';
  if (avg >= 0.7) return 'high';
  return 'medium';
};

const getCandidateLikelihood = (n) => {
  const cp = getClassifierProbability(n);
  return cp !== null ? clampPercent(cp) : clampPercent(getSegmentationProbability(n));
};

const toBackendAssetUrl = (url) => {
  if (!url) return null;
  return url.startsWith('http') ? url : `http://localhost:3001${url}`;
};

const getCandidateHeaderText = (count) => {
  if (count === 0) return 'No AI candidates';
  if (count === 1) return '1 AI candidate';
  return `${count} AI candidates`;
};

const getClassificationLabel = (candidate) => {
  const label = candidate?.coordinates?.classificationLabel;
  if (label) return label;
  return getCandidateLikelihood(candidate) >= 50
    ? 'Positive nodule candidate'
    : 'Negative / likely false positive';
};

const getCandidateSortScore = (candidate) => {
  const cp = Number(candidate?.coordinates?.classificationProbability);
  if (Number.isFinite(cp)) return cp;
  const ms = Number(candidate?.coordinates?.score);
  if (Number.isFinite(ms)) return ms;
  const p = Number(candidate?.probability);
  return Number.isFinite(p) ? p : 0;
};

// ─────────────────────────────────────────────────────────────────────────────

const buildXaiExplanations = (nodule) => {
  if (nodule.conceptScores && Object.keys(nodule.conceptScores).length > 0) {
    return Object.entries(nodule.conceptScores)
      .map(([key, val]) => ({ feature: CONCEPT_LABELS[key] || key, confidence: val }))
      .sort((a, b) => b.confidence - a.confidence);
  }
  return XAI_EXPLANATIONS[nodule.risk] || XAI_EXPLANATIONS.low;
};

export default function Review(){
  const { studyId } = useParams();
  const navigate = useNavigate();
  const viewerRef = useRef(null);
  const viewerInitialized = useRef(false);
  const initialNoduleSliceDone = useRef(false);
  const dicomFilesRef = useRef([]);
  const viewportTimerRef = useRef(null);
  
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

  // Ground truth state
  const [gtNodules, setGtNodules] = useState([]);
  const [gtSpacing, setGtSpacing] = useState({ sliceThickness: 1.0, pixelSpacing: 0.664 });
  const [showGT, setShowGT] = useState(false);
  // Segresnet overlay states (full-slice overlay from run_analysis.py)
  const [markerPositions, setMarkerPositions] = useState({});
  const [segmentationOverlay, setSegmentationOverlay] = useState(null);
  const [heatmapOverlay, setHeatmapOverlay] = useState(null);
  
  // Report state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportGenerating, setReportGenerating] = useState(false);
  // 3D viewer state
  const [viewer3DNodule, setViewer3DNodule] = useState(null);
  // Viewport version — increments on every cornerstone render, triggers overlay recalculation
  const [viewportVersion, setViewportVersion] = useState(0);

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

  useEffect(() => {
    if (!studyId) return;
    aiAPI.getGroundTruth(studyId)
      .then(res => {
        const MIN_MM = 5.5;
        setGtNodules((res.data.ground_truth || []).filter(g => g.diameter_mm >= MIN_MM));
        setGtSpacing({
          sliceThickness: res.data.slice_thickness_mm || 1.0,
          pixelSpacing: res.data.pixel_spacing_mm || 0.664,
        });
      })
      .catch(() => setGtNodules([]));
  }, [studyId]);

  // Debug mode: expose window.debug() to toggle GT overlay from browser console
  useEffect(() => {
    window.debug = () => setShowGT(prev => {
      const next = !prev;
      console.log('[Pulmo] GT debug mode:', next ? 'ON' : 'OFF');
      return next;
    });
    return () => { delete window.debug; };
  }, []);

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

  // Listen to cornerstone viewport changes (zoom, pan, new image) → recalculate overlays.
  // Debounced: zoom animations fire IMAGE_RENDERED many times per second; without
  // debouncing each intermediate frame gets a different position, causing circles to
  // visually accumulate. 60ms settles after the animation finishes.
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || !viewerReady) return;
    const bump = () => {
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
      viewportTimerRef.current = setTimeout(() => setViewportVersion(v => v + 1), 60);
    };
    el.addEventListener(cornerstone.EVENTS.IMAGE_RENDERED, bump);
    return () => {
      el.removeEventListener(cornerstone.EVENTS.IMAGE_RENDERED, bump);
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
    };
  }, [viewerReady]);

  // Convert image pixel coords → canvas pixel coords (respects zoom & pan).
  // pixelToCanvas returns coords relative to the dicom-viewer element; overlays are
  // positioned relative to viewer-wrapper (offsetParent). We add the element's own
  // offsetLeft/offsetTop to bridge that gap (non-zero when flexbox centers the viewer).
  const imgToCanvas = useCallback((ix, iy) => {
    if (!viewerRef.current) return null;
    try {
      const pt = cornerstone.pixelToCanvas(viewerRef.current, { x: ix, y: iy });
      pt.x += viewerRef.current.offsetLeft;
      pt.y += viewerRef.current.offsetTop;
      return pt;
    }
    catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportVersion]);

  // Circle style for a GT nodule at the current slice.
  // Radius shrinks as a sphere cross-section: r(dz) = sqrt(R² - dz²)
  const getGTCircleStyle = useCallback((gt, sliceIndex) => {
    try {
      const R_mm = gt.diameter_mm / 2;
      const dz_mm = Math.abs(sliceIndex - gt.slice_index) * gtSpacing.sliceThickness;
      const r_mm = Math.sqrt(Math.max(0, R_mm * R_mm - dz_mm * dz_mm));
      if (r_mm < 0.5) return null;
      const r_px_img = r_mm / gtSpacing.pixelSpacing; // radius in image pixels
      const center = imgToCanvas(gt.pixel_x, gt.pixel_y);
      const edgePt = imgToCanvas(gt.pixel_x + r_px_img, gt.pixel_y);
      if (!center || !edgePt) return null;
      const r = Math.max(4, edgePt.x - center.x);
      return {
        center,
        r,
        style: {
          position: 'absolute',
          left: `${center.x - r}px`,
          top: `${center.y - r}px`,
          width: `${r * 2}px`,
          height: `${r * 2}px`,
          border: '2px solid #00e676',
          borderRadius: '50%',
          pointerEvents: 'none',
          boxSizing: 'border-box',
        },
      };
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgToCanvas, gtSpacing]);

  // Position style for the 64×64 patch mask PNG
  const getPatchStyle = useCallback((nodule) => {
    let ix, iy;
    if (nodule.centerVoxel) {
      ix = nodule.centerVoxel.x;
      iy = nodule.centerVoxel.y;
    } else {
      // Fallback: derive image coords from percentage coordinates
      try {
        const ee = cornerstone.getEnabledElement(viewerRef.current);
        if (!ee?.image) return null;
        ix = (nodule.coordinates?.x ?? 50) / 100 * ee.image.width;
        iy = (nodule.coordinates?.y ?? 50) / 100 * ee.image.height;
      } catch { return null; }
    }
    const tl = imgToCanvas(ix - 32, iy - 32);
    const br = imgToCanvas(ix + 32, iy + 32);
    if (!tl || !br) return null;
    return {
      position: 'absolute',
      left:   `${tl.x}px`,
      top:    `${tl.y}px`,
      width:  `${Math.max(8, br.x - tl.x)}px`,
      height: `${Math.max(8, br.y - tl.y)}px`,
      pointerEvents: 'none',
    };
  }, [imgToCanvas]);

  // Position style for nodule circle marker — follows zoom & pan
  const getMarkerStyle = useCallback((nodule) => {
    try {
      const ee = cornerstone.getEnabledElement(viewerRef.current);
      if (!ee?.image) throw new Error('no image');
      const ix = (nodule.coordinates?.x ?? 50) / 100 * ee.image.width;
      const iy = (nodule.coordinates?.y ?? 50) / 100 * ee.image.height;
      const c = cornerstone.pixelToCanvas(viewerRef.current, { x: ix, y: iy });
      return { left: `${c.x}px`, top: `${c.y}px` };
    } catch {
      return {
        left: `${nodule.coordinates?.x ?? 50}%`,
        top:  `${nodule.coordinates?.y ?? 50}%`,
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportVersion]);

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

        // Load nodules: prefer real DB nodules, fall back to mock
        const dbNodules = studyData.nodules || [];
        let loadedNodules;

        if (dbNodules.length > 0) {
          // Real nodules from DB (from Pulmo analysis or prior saves)
          loadedNodules = dbNodules.map((n, i) => {
            let coords = { x: 50, y: 50 };
            try { if (n.coordinates) coords = JSON.parse(n.coordinates); } catch {}
            let allSliceIndices = n.slice_index !== undefined ? [n.slice_index] : [];
            try { if (n.all_slice_indices) allSliceIndices = JSON.parse(n.all_slice_indices); } catch {}
            let conceptScores = null;
            try { if (n.concept_scores) conceptScores = JSON.parse(n.concept_scores); } catch {}
            let maskPaths = {};
            try { if (n.mask_paths) maskPaths = JSON.parse(n.mask_paths); } catch {}
            let centerVoxel = null;
            try { if (n.center_voxel) centerVoxel = JSON.parse(n.center_voxel); } catch {}

            const riskKey = (n.risk_level || 'Low').toLowerCase();
            const noduleObj = {
              id: n.id,
              nodule_number: n.nodule_number || i + 1,
              location: n.location || 'RUL',
              locationFull: getLocationFullName(n.location || 'RUL'),
              size: n.size_mm ? parseFloat(n.size_mm).toFixed(1) : '0.0',
              probability: n.probability || 0,
              risk: riskKey,
              sliceIndex: n.slice_index || 0,
              reviewed: !!n.reviewed,
              includeInReport: n.include_in_report !== false,
              notes: n.notes || '',
              doctorAssessment: n.doctor_assessment || '',
              coordinates: coords,
              allSliceIndices,
              conceptScores,
              maskPaths,
              centerVoxel,
              detectionProb: n.detection_prob || 0,
            };
            noduleObj.xaiExplanations = buildXaiExplanations(noduleObj);
            // Apply segresnet-style risk override when classifier prob available
            noduleObj.risk = getCandidateRisk(noduleObj);
            return noduleObj;
          })
          .sort((a, b) => getCandidateSortScore(b) - getCandidateSortScore(a))
          .map((n, i) => ({ ...n, displayRank: i + 1 }));
        } else {
          // Mock nodules (no AI analysis yet)
          const noduleCount = studyData.nodule_count || 0;
          const locations = ['RUL', 'LUL', 'RML', 'RLL', 'LLL'];
          loadedNodules = Array.from({ length: noduleCount }, (_, i) => {
            const risk = i < noduleCount / 3 ? 'high' : i < noduleCount * 2 / 3 ? 'medium' : 'low';
            const sliceIdx = Math.floor(Math.random() * (studyData.dicomFiles?.length || 1));
            const noduleObj = {
              id: i + 1,
              nodule_number: i + 1,
              location: locations[i % 5],
              locationFull: getLocationFullName(locations[i % 5]),
              size: (6 + i * 2.5).toFixed(1),
              probability: (0.65 + Math.random() * 0.3).toFixed(2),
              risk,
              sliceIndex: sliceIdx,
              reviewed: false,
              includeInReport: true,
              notes: '',
              doctorAssessment: '',
              coordinates: { x: 45 + Math.random() * 10, y: 40 + Math.random() * 20 },
              allSliceIndices: [sliceIdx],
              conceptScores: null,
              maskPaths: {},
              centerVoxel: null,
              detectionProb: 0,
            };
            noduleObj.xaiExplanations = XAI_EXPLANATIONS[risk];
            return noduleObj;
          });
        }
        setNodules(loadedNodules.filter(n => parseFloat(n.size) >= 5.5));
        
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
  const reviewedCount = nodules.filter(n => n.reviewed).length;
  const candidateHeaderText = getCandidateHeaderText(nodules.length);

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
            {nodules.length > 0 ? `${reviewedCount}/${nodules.length} Reviewed` : 'No candidates'}
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
                      <span className="ai-stat-value">{nodules.length}</span>
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
              {/* GT button hidden — debug mode only, toggle via window.debug() in console */}
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
                
                {/* SEG overlay — SegResNet full-slice OR Pulmo 64×64 patch */}
                {showSegmentation && (() => {
                  // SegResNet: full-slice overlay image stored in segmentationOverlay state
                  if (segmentationOverlay) {
                    return (
                      <img
                        key="seg-overlay-segresnet"
                        className="segmentation-overlay-image"
                        src={segmentationOverlay.src}
                        style={{ position: 'absolute', objectFit: 'fill', opacity: 0.65, ...segmentationOverlay.style }}
                        onError={() => setSegmentationOverlay(null)}
                        alt=""
                        draggable={false}
                      />
                    );
                  }
                  // Pulmo: 64×64 patch mask per nodule
                  return nodules.map((nodule) => {
                    if (nodule.detectionProb > 0 && nodule.detectionProb <= 0.5) return null;
                    const allSlices = nodule.allSliceIndices?.length > 0 ? nodule.allSliceIndices : [nodule.sliceIndex];
                    if (!allSlices.includes(currentImageIndex)) return null;
                    const segPath = nodule.maskPaths?.[`${currentImageIndex}_seg`] ?? nodule.maskPaths?.[String(currentImageIndex)];
                    const patchStyle = getPatchStyle(nodule);
                    if (!segPath || !patchStyle) return null;
                    return (
                      <img
                        key={`seg-${nodule.id}-${currentImageIndex}`}
                        src={`http://localhost:3001/uploads/${studyId}/${segPath}`}
                        style={{ ...patchStyle, objectFit: 'fill' }}
                        alt=""
                        draggable={false}
                      />
                    );
                  });
                })()}

                {/* HEAT overlay — SegResNet GradCAM OR Pulmo concept heatmap */}
                {showHeatmap && (() => {
                  // SegResNet: full-slice heatmap
                  if (heatmapOverlay) {
                    return (
                      <img
                        key="heat-overlay-segresnet"
                        className="heatmap-overlay-image"
                        src={heatmapOverlay.src}
                        style={{ position: 'absolute', objectFit: 'fill', opacity: 0.7, ...heatmapOverlay.style }}
                        onError={() => setHeatmapOverlay(null)}
                        alt=""
                        draggable={false}
                      />
                    );
                  }
                  // Pulmo: concept-weighted XAI heatmap
                  const hasRealHeat = nodules.some(n => Object.keys(n.maskPaths || {}).some(k => k.endsWith('_heat')));
                  if (!hasRealHeat) return <div className="heatmap-overlay"><div className="heatmap-gradient" /></div>;
                  return nodules.map((nodule) => {
                    if (nodule.detectionProb > 0 && nodule.detectionProb <= 0.5) return null;
                    const allSlices = nodule.allSliceIndices?.length > 0 ? nodule.allSliceIndices : [nodule.sliceIndex];
                    if (!allSlices.includes(currentImageIndex)) return null;
                    const heatPath = nodule.maskPaths?.[`${currentImageIndex}_heat`];
                    const patchStyle = getPatchStyle(nodule);
                    if (!heatPath || !patchStyle) return null;
                    return (
                      <img
                        key={`heat-${nodule.id}-${currentImageIndex}`}
                        src={`http://localhost:3001/uploads/${studyId}/${heatPath}`}
                        style={{ ...patchStyle, objectFit: 'fill' }}
                        alt=""
                        draggable={false}
                      />
                    );
                  });
                })()}

                {/* GT: circles sized to sphere cross-section at each slice */}
                {showGT && gtNodules.map((gt) => {
                  if (currentImageIndex < gt.slice_min || currentImageIndex > gt.slice_max) return null;
                  const hit = getGTCircleStyle(gt, currentImageIndex);
                  if (!hit) return null;
                  return (
                    <React.Fragment key={`gt-${gt.idx}`}>
                      <div style={hit.style} />
                      <div style={{
                        position: 'absolute',
                        left: `${hit.center.x + hit.r + 4}px`,
                        top: `${hit.center.y - 9}px`,
                        color: '#00e676',
                        fontSize: '11px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        textShadow: '0 0 4px #000, 0 0 2px #000',
                        pointerEvents: 'none',
                      }}>
                        GT#{gt.idx} {gt.diameter_mm}mm
                        {gt.hu_center != null && (
                          <span style={{ fontSize: '10px', opacity: 0.8, marginLeft: 4 }}>
                            ({gt.hu_center > -100 ? 'solid' : gt.hu_center > -500 ? 'GGO' : 'air'} {gt.hu_center}HU)
                          </span>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}

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
              <div className="panel-header">
                <h3>AI Candidates ({nodules.length})</h3>
                {nodules.length > 0
                  ? <p className="panel-subtitle">Showing classifier-ranked review candidates</p>
                  : <p className="panel-subtitle">No clinically significant AI candidate was selected for review</p>}
              </div>
              {showGT && gtNodules.length > 0 && (
                <div className="gt-comparison-panel">
                  <div className="gt-comparison-header">
                    <span style={{ color: '#00e676' }}>GT (LIDC)</span>
                    <span style={{ color: '#ff9800' }}>Model</span>
                  </div>
                  <div className="gt-comparison-table">
                    {gtNodules.map(gt => {
                      const matched = nodules.find(n => {
                        const sliceDiff = Math.abs((n.sliceIndex || 0) - gt.slice_index);
                        return sliceDiff <= Math.max(3, gt.diameter_mm / 2);
                      });
                      return (
                        <div
                          key={`gt-row-${gt.idx}`}
                          className={`gt-row ${matched ? 'gt-matched' : 'gt-missed'}`}
                          onClick={() => setCurrentImageIndex(gt.slice_index)}
                          title="Click to jump to this slice"
                        >
                          <div className="gt-cell gt-cell-left">
                            <span className="gt-label">GT#{gt.idx}</span>
                            <span className="gt-detail">
                              {gt.diameter_mm}mm · mal={gt.malignancy.toFixed(1)}
                              {gt.hu_center != null && (
                                <span style={{ marginLeft: 4, color: gt.hu_center > -100 ? '#fbbf24' : '#60a5fa' }}>
                                  · {gt.hu_center > -100 ? 'solid' : gt.hu_center > -500 ? 'GGO' : 'air'} {gt.hu_center}HU
                                </span>
                              )}
                            </span>
                            <span className="gt-slice">slice {gt.slice_index + 1}</span>
                          </div>
                          <div className="gt-cell gt-cell-right">
                            {matched ? (
                              <>
                                <span className={`gt-model-badge ${matched.risk}`}>
                                  #{matched.nodule_number}
                                </span>
                                <span className="gt-detail">{matched.size}mm</span>
                              </>
                            ) : (
                              <span className="gt-missed-label">missed</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="nodules-list">
                {nodules.length > 0 ? nodules.map((nodule, i) => (
                  <div key={nodule.id} className={`nodule-item ${selectedNodule === i ? 'selected' : ''} ${nodule.reviewed ? 'reviewed' : ''}`}
                    onClick={() => goToNoduleSlice(nodule, i)}>
                    <div className="nodule-item-header">
                      <span className="nodule-number">#{nodule.displayRank || nodule.nodule_number || i + 1}</span>
                      <span className={`risk-badge ${nodule.risk}`}>{getCandidateLikelihood(nodule).toFixed(0)}%</span>
                    </div>
                    <div className="nodule-item-info">
                      <span>Slice {getValidSliceIndex(nodule, dicomFiles.length) + 1} - {nodule.size} mm eq. dia.</span>
                      <span>
                        Seg {clampPercent(getSegmentationProbability(nodule)).toFixed(0)}%
                        {getClassifierProbability(nodule) !== null && ` | Cls ${getCandidateLikelihood(nodule).toFixed(0)}%`}
                      </span>
                    </div>
                  </div>
                )) : (
                  <div className="no-nodules">
                    <strong>No AI candidates detected</strong>
                    <span>
                      The CT viewer is still available, but this study currently has no model-selected
                      review candidate.
                    </span>
                  </div>
                )}
              </div>

              {nodules.length > 0 && currentNodule && (
                <div className="nodule-details">
                  <div className="details-header">
                    <h4>AI Candidate #{currentNodule.displayRank || currentNodule.nodule_number}</h4>
                    <span className={`risk-indicator ${currentNodule.risk}`}>{getCandidateLikelihood(currentNodule).toFixed(0)}%</span>
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
                        <div className="probability-bar"><div className={`probability-fill ${currentNodule.risk}`} style={{ width: `${getCandidateLikelihood(currentNodule)}%` }} /></div>
                        <span>{getCandidateLikelihood(currentNodule).toFixed(0)}%</span>
                      </div>
                      <div className="classification-result">
                        <span>Segmentation probability: {getSegmentationProbability(currentNodule).toFixed(3)}</span>
                      </div>
                      {getClassifierProbability(currentNodule) !== null && (
                        <div className="classification-result">
                          <strong>{getClassificationLabel(currentNodule)}</strong>
                          <span>Classifier probability: {getClassifierProbability(currentNodule).toFixed(3)}</span>
                        </div>
                      )}
                    </div>

                    <div className="detail-section xai-section">
                      <label>XAI Explanation <span style={{fontSize:'0.7em',color:'#666',fontWeight:'normal'}}>(concept model — indicative only)</span></label>
                      <div className="xai-features">
                        {buildXaiExplanations(currentNodule).map((exp, i) => (
                          <div key={i} className="xai-feature">
                            <span>{exp.feature}</span>
                            <div className="confidence-bar"><div style={{ width: `${exp.confidence * 100}%` }} /><span>{(exp.confidence * 100).toFixed(0)}%</span></div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {currentNodule.centerVoxel && (
                      <div className="detail-section">
                        <button
                          className="view-3d-btn"
                          onClick={() => setViewer3DNodule(currentNodule)}
                        >
                          3D View
                        </button>
                      </div>
                    )}

                    {/* SegResNet Classifier GradCAM explanation */}
                    {(currentNodule.coordinates?.classifierPanelsUrl || currentNodule.coordinates?.classifierGradcamUrl) && (
                      <div className="detail-section classifier-explanation-section">
                        <label>Classifier Explanation (GradCAM)</label>
                        <img
                          className="classifier-panels-image"
                          src={toBackendAssetUrl(currentNodule.coordinates.classifierPanelsUrl || currentNodule.coordinates.classifierGradcamUrl)}
                          alt="Classifier GradCAM explanation"
                          style={{ width: '100%', borderRadius: '4px', marginTop: '6px' }}
                        />
                        <p style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                          Research/demo only — not for clinical diagnosis.
                        </p>
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

              {nodules.length === 0 && (
                <div className="nodule-details empty-details">
                  <div className="details-header">
                    <h4>{candidateHeaderText}</h4>
                  </div>
                  <div className="details-content">
                    <div className="empty-state-card">
                      <p>
                        This study is currently behaving like a no-candidate case in the review UI.
                      </p>
                      <ul>
                        <li>No final AI candidate was selected by the pipeline.</li>
                        <li>Segmentation and classifier outputs did not produce a reviewable final candidate.</li>
                        <li>You can still inspect slices manually in the viewer.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
        </div>
      </div>

      {/* 3D Nodule Viewer Modal */}
      {viewer3DNodule && (
        <NoduleViewer3D
          nodule={viewer3DNodule}
          studyId={studyId}
          onClose={() => setViewer3DNodule(null)}
        />
      )}

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
                {nodules.filter(n => n.includeInReport).length > 0 ? nodules.filter(n => n.includeInReport).map(nodule => (
                  <div key={nodule.id} className="nodule-preview-item">
                    <span>#{nodule.displayRank || nodule.nodule_number} - {nodule.location}</span>
                    <span>{getCandidateLikelihood(nodule).toFixed(0)}%</span>
                    <span className={`risk-tag ${nodule.risk}`}>{nodule.risk}</span>
                    {nodule.doctorAssessment && <span className={`assessment-tag ${nodule.doctorAssessment}`}>{nodule.doctorAssessment}</span>}
                  </div>
                )) : (
                  <div className="empty-report-state" style={{ color: '#666', fontSize: '13px', padding: '8px 0' }}>
                    No AI candidate is currently included in the report.
                  </div>
                )}
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

