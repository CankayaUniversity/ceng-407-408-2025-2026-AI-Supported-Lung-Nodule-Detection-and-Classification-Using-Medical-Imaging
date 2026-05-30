import { useState, useEffect, useRef } from 'react';
import { aiAPI } from '../services/api';
import { cornerstone } from '../utils/dicomUtils';
import './NoduleViewer3D.css';

const BACKEND = 'http://localhost:3001';

export default function NoduleViewer3D({ nodule, studyId, onClose }) {
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [seriesFiles, setSeriesFiles] = useState([]);
  const [currentSlice, setCurrentSlice] = useState(0);
  const [seriesPath, setSeriesPath] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const viewerRef = useRef(null);
  const viewerInitRef = useRef(false);

  // Trigger 3D export on mount
  useEffect(() => {
    exportAndLoad();
  }, [nodule.id]);

  const exportAndLoad = async () => {
    setStatus('loading');
    try {
      const res = await aiAPI.exportNodule3D(nodule.id);
      const data = res.data;
      setSeriesPath(data.series_path);
      setSeriesFiles(data.files || []);
      setCurrentSlice(Math.floor((data.files?.length || 1) / 2));
      setStatus('ready');
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to generate 3D view');
      setStatus('error');
    }
  };

  // Load a DCM slice into the cornerstone viewer
  useEffect(() => {
    if (status !== 'ready' || !viewerRef.current || seriesFiles.length === 0) return;

    const loadSlice = async () => {
      const el = viewerRef.current;
      const file = seriesFiles[currentSlice];
      if (!file) return;

      const imageId = `wadouri:${BACKEND}/uploads/${studyId}/${file}`;
      try {
        if (!viewerInitRef.current) {
          cornerstone.enable(el);
          viewerInitRef.current = true;
        }
        const image = await cornerstone.loadAndCacheImage(imageId);
        cornerstone.displayImage(el, image);
        const vp = cornerstone.getViewport(el);
        if (vp) {
          vp.voi.windowWidth = 1500;
          vp.voi.windowCenter = -600;
          cornerstone.setViewport(el, vp);
        }
      } catch (e) {
        console.error('3D viewer load error:', e);
      }
    };

    loadSlice();
  }, [status, currentSlice, seriesFiles, studyId]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        setCurrentSlice(s => Math.max(0, s - 1));
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        setCurrentSlice(s => Math.min(seriesFiles.length - 1, s + 1));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [seriesFiles.length, onClose]);

  const handleDownload = async () => {
    if (!seriesFiles.length) return;
    // Download each DCM file one by one
    for (const file of seriesFiles) {
      const url = `${BACKEND}/uploads/${studyId}/${file}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = file.split('/').pop();
      a.click();
      await new Promise(r => setTimeout(r, 50));
    }
  };

  return (
    <div className="viewer3d-overlay" onClick={onClose}>
      <div className="viewer3d-modal" onClick={e => e.stopPropagation()}>
        <div className="viewer3d-header">
          <div className="viewer3d-title">
            <span>3D Nodule View</span>
            <span className="viewer3d-subtitle">
              Nodule #{nodule.nodule_number || nodule.id} — {nodule.location} — {nodule.size} mm
            </span>
          </div>
          <div className="viewer3d-actions">
            {status === 'ready' && (
              <button className="viewer3d-download-btn" onClick={handleDownload}>
                Download DCM Series
              </button>
            )}
            <button className="viewer3d-close-btn" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="viewer3d-body">
          {status === 'loading' && (
            <div className="viewer3d-loading">
              <div className="viewer3d-spinner" />
              <p>Generating 3D nodule patch...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="viewer3d-error">
              <p>Could not generate 3D view: {errorMsg}</p>
              <p className="viewer3d-error-hint">Make sure the AI service is running and the model is downloaded.</p>
              <button className="viewer3d-retry-btn" onClick={exportAndLoad}>Retry</button>
            </div>
          )}

          {status === 'ready' && (
            <>
              <div className="viewer3d-info-bar">
                <span className={`viewer3d-risk ${nodule.risk}`}>{nodule.risk?.toUpperCase()}</span>
                <span>Malignancy: {(nodule.probability * 100).toFixed(0)}%</span>
                <span>Slices: {seriesFiles.length}</span>
              </div>

              <div className="viewer3d-canvas-wrap">
                <div
                  ref={viewerRef}
                  className="viewer3d-canvas"
                  style={{ width: '400px', height: '400px', background: '#000' }}
                />
              </div>

              <div className="viewer3d-nav">
                <button
                  className="viewer3d-nav-btn"
                  onClick={() => setCurrentSlice(s => Math.max(0, s - 1))}
                  disabled={currentSlice === 0}
                >
                  ‹ Prev
                </button>
                <div className="viewer3d-slider-wrap">
                  <input
                    type="range"
                    min={0}
                    max={seriesFiles.length - 1}
                    value={currentSlice}
                    onChange={e => setCurrentSlice(parseInt(e.target.value))}
                    className="viewer3d-slider"
                  />
                  <span className="viewer3d-slice-info">{currentSlice + 1} / {seriesFiles.length}</span>
                </div>
                <button
                  className="viewer3d-nav-btn"
                  onClick={() => setCurrentSlice(s => Math.min(seriesFiles.length - 1, s + 1))}
                  disabled={currentSlice === seriesFiles.length - 1}
                >
                  Next ›
                </button>
              </div>

              {nodule.conceptScores && (
                <div className="viewer3d-concepts">
                  <h4>Concept Scores (XAI)</h4>
                  <div className="viewer3d-concept-grid">
                    {Object.entries(nodule.conceptScores).map(([key, val]) => (
                      <div key={key} className="viewer3d-concept-row">
                        <span className="viewer3d-concept-label">
                          {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                        </span>
                        <div className="viewer3d-concept-bar">
                          <div
                            className="viewer3d-concept-fill"
                            style={{ width: `${val * 100}%`, opacity: 0.8 + val * 0.2 }}
                          />
                        </div>
                        <span className="viewer3d-concept-val">{(val * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
