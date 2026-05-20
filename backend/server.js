import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { spawn } from 'child_process';

// Load environment variables
dotenv.config();

import {
  initDatabase,
  createPatient,
  getPatient,
  getAllPatients,
  deletePatient,
  createStudy,
  getStudy,
  getAllStudies,
  updateStudyStatus,
  markStudyAsReviewed,
  deleteStudy,
  saveDicomFile,
  getDicomFilesByStudy,
  saveNodule,
  getNodulesByStudy,
  updateNodule,
  getNodule,
  deleteNodule,
  deleteNodulesByStudy,
  createUser,
  getUser,
  getUserByUsername,
  getAllUsers,
  updateUserStatus,
  updateUserLastLogin,
  updateUserProfile,
  deleteUser,
  getDashboardStats,
  getUserStats,
  createActivityLog,
  getActivityLogs,
  getRecentActivityLogs,
  createReport,
  getReport,
  getAllReports,
  getReportsByUser,
  deleteReport
} from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const PYTHON_EXECUTABLE = process.env.PYTHON_EXECUTABLE || 'python';

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length']
}));
app.use(express.json());

const runPythonJsonScript = (scriptName, payload) => new Promise((resolve, reject) => {
  const pythonProcess = spawn(PYTHON_EXECUTABLE, [scriptName], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1'
    }
  });

  let stdout = '';
  let stderr = '';

  pythonProcess.stdout.on('data', (data) => {
    stdout += data.toString('utf8');
  });

  pythonProcess.stderr.on('data', (data) => {
    stderr += data.toString('utf8');
  });

  pythonProcess.on('error', (error) => {
    reject(error);
  });

  pythonProcess.on('close', (code) => {
    if (code !== 0) {
      reject(new Error(stderr || `Python process exited with code ${code}`));
      return;
    }

    try {
      resolve(JSON.parse(stdout));
    } catch (error) {
      reject(new Error(`Failed to parse Python JSON output: ${error.message}`));
    }
  });

  pythonProcess.stdin.end(Buffer.from(JSON.stringify(payload || {}), 'utf8'));
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve test HTML file
app.get('/test-dicom.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'test-dicom.html'));
});

// Serve uploaded files statically with proper headers for DICOM
app.use('/uploads', (req, res, next) => {
  // Set CORS headers for DICOM files
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  
  // Set content type for DICOM files
  if (req.path.endsWith('.dcm') || req.path.endsWith('.dicom')) {
    res.setHeader('Content-Type', 'application/dicom');
  }
  
  next();
}, express.static(uploadsDir));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const studyId = req.body.study_id || 'temp';
    const studyPath = path.join(uploadsDir, studyId);
    if (!fs.existsSync(studyPath)) {
      fs.mkdirSync(studyPath, { recursive: true });
    }
    cb(null, studyPath);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// ============ PATIENT ROUTES ============
app.post('/api/patients', async (req, res) => {
  try {
    console.log('Received patient data:', req.body);
    const id = await createPatient(req.body);
    console.log('Patient created with ID:', id);
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error creating patient:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/patients', async (req, res) => {
  try {
    const patients = await getAllPatients();
    res.json(patients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/patients/:patientId', async (req, res) => {
  try {
    const patient = await getPatient(req.params.patientId);
    if (patient) {
      res.json(patient);
    } else {
      res.status(404).json({ error: 'Patient not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ STUDY ROUTES ============
app.post('/api/studies', async (req, res) => {
  try {
    console.log('Received study data:', req.body);
    const id = await createStudy(req.body);
    console.log('Study created with ID:', id);
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error creating study:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/studies', async (req, res) => {
  try {
    const studies = await getAllStudies();
    res.json(studies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/studies/:studyId', async (req, res) => {
  try {
    const study = await getStudy(req.params.studyId);
    if (study) {
      const dicomFiles = await getDicomFilesByStudy(req.params.studyId);
      const nodules = await getNodulesByStudy(req.params.studyId);
      res.json({ ...study, dicomFiles, nodules });
    } else {
      res.status(404).json({ error: 'Study not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/studies/:studyId/status', async (req, res) => {
  try {
    const { status, noduleCount } = req.body;
    await updateStudyStatus(req.params.studyId, status, noduleCount);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/studies/:studyId/reviewed', async (req, res) => {
  try {
    const { user_id } = req.body;
    await markStudyAsReviewed(req.params.studyId, user_id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ DICOM UPLOAD ROUTE ============
app.post('/api/upload-dicom', upload.array('dicomFiles', 500), async (req, res) => {
  try {
    const { study_id } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const savedFiles = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileData = {
        study_id,
        file_path: `/uploads/${study_id}/${file.filename}`,
        file_name: file.filename,
        instance_number: i + 1
      };
      await saveDicomFile(fileData);
      savedFiles.push(fileData);
    }

    res.json({
      success: true,
      message: `${files.length} DICOM files uploaded successfully`,
      files: savedFiles
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/studies/:studyId/dicom-files', async (req, res) => {
  try {
    const files = await getDicomFilesByStudy(req.params.studyId);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ SEED DICOM FILES FROM UPLOADS FOLDER ============
app.post('/api/seed-dicoms', async (req, res) => {
  try {
    const uploadsPath = path.join(__dirname, 'uploads');
    const folders = fs.readdirSync(uploadsPath).filter(f => 
      fs.statSync(path.join(uploadsPath, f)).isDirectory() && f.startsWith('STD-')
    );
    
    const results = [];
    
    for (const folder of folders) {
      const studyId = folder;
      const folderPath = path.join(uploadsPath, folder);
      const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.dcm'));
      
      // Check if study exists
      const existingStudy = await getStudy(studyId);
      
      if (!existingStudy) {
        // Create patient and study
        const patientId = `P-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
        const patientNames = ['John Smith', 'Mary Johnson', 'Robert Williams', 'Sarah Brown', 'Michael Davis'];
        const patientName = patientNames[folders.indexOf(folder) % patientNames.length];
        
        await createPatient({
          patient_id: patientId,
          name: patientName,
          age: 45 + Math.floor(Math.random() * 30),
          gender: Math.random() > 0.5 ? 'Male' : 'Female'
        });
        
        await createStudy({
          study_id: studyId,
          patient_id: patientId,
          study_date: new Date().toISOString().split('T')[0],
          description: 'CT Chest Study',
          nodule_count: Math.floor(Math.random() * 5) + 1,
          status: 'pending'
        });
      }
      
      // Check existing DICOM files for this study
      const existingFiles = await getDicomFilesByStudy(studyId);
      const existingFileNames = existingFiles.map(f => f.file_name);
      
      // Save DICOM files to database
      let addedCount = 0;
      for (let i = 0; i < files.length; i++) {
        const fileName = files[i];
        if (!existingFileNames.includes(fileName)) {
          await saveDicomFile({
            study_id: studyId,
            file_path: `/uploads/${folder}/${fileName}`,
            file_name: fileName,
            instance_number: i + 1
          });
          addedCount++;
        }
      }
      
      results.push({
        studyId,
        totalFiles: files.length,
        newFilesAdded: addedCount,
        existingFiles: existingFileNames.length
      });
    }
    
    res.json({
      success: true,
      message: `Processed ${folders.length} study folders`,
      results
    });
  } catch (error) {
    console.error('Error seeding DICOMs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const SEGMENTATION_MODELS = {
  best: {
    label: 'Best SegResNet',
    file: 'segresnet_25d_best_.pt'
  },
  adam: {
    label: 'Adam 25D',
    file: 'segresnet_25d_adam.pt'
  }
};

app.post('/api/nlp/analyze-note', async (req, res) => {
  try {
    const analysis = await runPythonJsonScript('nlp_analysis.py', req.body || {});
    res.json({ success: true, analysis });
  } catch (error) {
    console.error('Error running NLP analysis:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ AI ANALYSIS ROUTE ============
app.post('/api/analyze-dicom/:studyId', async (req, res) => {
  const studyId = req.params.studyId;
  const topK = Math.min(req.body?.top_k || 3, 3);
  const requestedModelKey = req.body?.modelKey || req.query?.model || 'best';
  const selectedModel = SEGMENTATION_MODELS[requestedModelKey];

  if (!selectedModel) {
    return res.status(400).json({
      success: false,
      error: `Unknown segmentation model "${requestedModelKey}". Available models: ${Object.keys(SEGMENTATION_MODELS).join(', ')}`
    });
  }
  
  try {
    console.log(`Starting AI analysis for study: ${studyId} with model: ${requestedModelKey}`);
    
    // Get study data to verify it exists
    const study = await getStudy(studyId);
    if (!study) {
      return res.status(404).json({ 
        success: false, 
        error: `Study not found: ${studyId}` 
      });
    }
    
    // Get DICOM files for this study
    const dicomFiles = await getDicomFilesByStudy(studyId);
    if (!dicomFiles || dicomFiles.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: `No DICOM files found for study: ${studyId}` 
      });
    }
    
    // Prepare paths
    const studyDir = path.join(__dirname, 'uploads', studyId);
    const modelPath = path.join(__dirname, 'models', selectedModel.file);
    const overlaysDir = path.join(__dirname, 'uploads', studyId, 'overlays');
    
    // Check model exists
    if (!fs.existsSync(modelPath)) {
      return res.status(500).json({ 
        success: false, 
        error: `Model checkpoint not found at ${modelPath}` 
      });
    }
    
    // Run Python analysis asynchronously
    console.log(`Running analysis with: ${PYTHON_EXECUTABLE} run_analysis.py "${studyDir}" "${modelPath}" "${overlaysDir}" ${topK}`);
    
    const pythonProcess = spawn(PYTHON_EXECUTABLE, [
      'run_analysis.py',
      studyDir,
      modelPath,
      overlaysDir,
      topK.toString()
    ], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('Python stderr:', data.toString());
    });
    
    pythonProcess.on('close', async (code) => {
      try {
        if (code !== 0) {
          console.error('Python process failed with code:', code);
          console.error('stdout:', stdout);
          console.error('stderr:', stderr);
          return res.status(500).json({
            success: false,
            error: `AI analysis failed: ${stderr || 'Unknown error'}`
          });
        }
        
        // Parse JSON results from stdout
        const analysisResults = JSON.parse(stdout);
        
        if (!analysisResults.success) {
          return res.status(500).json({
            success: false,
            error: analysisResults.error || 'AI analysis failed'
          });
        }
        
        // Save candidates to database
        console.log(`Analysis found ${analysisResults.top_candidates} candidates`);
        
        // Delete existing nodules for this study
        await deleteNodulesByStudy(studyId);
        
        // Save new nodules from analysis
        for (let i = 0; i < analysisResults.candidates.length; i++) {
          const candidate = analysisResults.candidates[i];
          const overlayUrl = candidate.overlayUrl
            ? `/uploads/${studyId}/overlays/${path.basename(candidate.overlayUrl)}`
            : null;
          const overlayPath = overlayUrl ? path.join(__dirname, overlayUrl.replace(/^\/uploads\//, 'uploads/')) : null;
          const safeOverlayUrl = overlayPath && fs.existsSync(overlayPath) ? overlayUrl : null;
          const coordinates = {
            ...(candidate.coordinates || {}),
            bbox: candidate.bbox || null,
            overlayUrl: safeOverlayUrl,
            maskUrl: candidate.maskUrl || null,
            segmentationModel: requestedModelKey,
            segmentationModelLabel: selectedModel.label,
            heatmapUrl: null,
            classifierCropUrl: null,
            classifierGradcamUrl: null,
            classifierPanelsUrl: null,
            classifierFullGradcamUrl: null,
            modelSliceIndex: candidate.modelSliceIndex ?? null,
            windowSize: candidate.windowSize ?? null,
            score: candidate.score ?? null,
            maxProbability: candidate.maxProbability ?? null,
            maskArea: candidate.maskArea ?? null,
            segmentationProbability: candidate.segmentationProbability ?? null,
            classificationProbability: candidate.classificationProbability ?? null,
            classificationPredictedClass: candidate.classificationPredictedClass ?? null,
            classificationLabel: candidate.classificationLabel ?? null,
            classificationCenter: candidate.classificationCenter ?? null,
            classificationCrop: candidate.classificationCrop ?? null,
            gradcamShape: candidate.gradcamShape ?? null
          };

          if (candidate.heatmapUrl) {
            const heatmapUrl = candidate.heatmapUrl.includes('classifier_explanations')
              ? `/uploads/${studyId}/overlays/classifier_explanations/${path.basename(candidate.heatmapUrl)}`
              : `/uploads/${studyId}/overlays/${path.basename(candidate.heatmapUrl)}`;
            const heatmapPath = path.join(__dirname, heatmapUrl.replace(/^\/uploads\//, 'uploads/'));
            coordinates.heatmapUrl = fs.existsSync(heatmapPath) ? heatmapUrl : null;
          }

          for (const [field, value] of [
            ['classifierCropUrl', candidate.classifierCropUrl],
            ['classifierGradcamUrl', candidate.classifierGradcamUrl],
            ['classifierPanelsUrl', candidate.classifierPanelsUrl],
            ['classifierFullGradcamUrl', candidate.classifierFullGradcamUrl]
          ]) {
            if (!value) continue;
            const assetUrl = `/uploads/${studyId}/overlays/classifier_explanations/${path.basename(value)}`;
            const assetPath = path.join(__dirname, assetUrl.replace(/^\/uploads\//, 'uploads/'));
            coordinates[field] = fs.existsSync(assetPath) ? assetUrl : null;
          }

          const classifierProbability = candidate.classificationProbability ?? null;
          const classifierNote = candidate.classificationLabel
            ? `Model prediction - ${selectedModel.label}; Confidence: ${candidate.confidence}; Classifier: ${candidate.classificationLabel}${classifierProbability ? ` (${classifierProbability})` : ''}`
            : `Model prediction - ${selectedModel.label}; Confidence: ${candidate.confidence}`;
          const noduleData = {
            study_id: studyId,
            nodule_number: candidate.nodule_number,
            location: candidate.location,
            size_mm: parseFloat(candidate.size),
            risk_level: candidate.risk,
            coordinates: JSON.stringify(coordinates),
            slice_index: candidate.sliceIndex,
            probability: parseFloat(candidate.probability),
            doctor_assessment: null,
            notes: classifierNote,
            include_in_report: true,
            reviewed: false
          };
          
          try {
            await saveNodule(noduleData);
          } catch (dbError) {
            console.warn(`Failed to save nodule ${i}:`, dbError.message);
          }
        }
        
        // Update study status
        await updateStudyStatus(studyId, 'completed', analysisResults.top_candidates);
        
        // Return results
        res.json({
          success: true,
          nodule_count: analysisResults.top_candidates,
          candidates: analysisResults.candidates,
          metadata: {
            segmentation_model: requestedModelKey,
            segmentation_model_label: selectedModel.label,
            total_slices: analysisResults.num_slices,
            volume_shape: analysisResults.volume_shape,
            total_regions_found: analysisResults.total_candidates_found
          }
        });
        
      } catch (parseError) {
        console.error('Error parsing analysis results:', parseError);
        console.error('Python output:', stdout);
        res.status(500).json({
          success: false,
          error: `Failed to parse analysis results: ${parseError.message}`
        });
      }
    });
    
  } catch (error) {
    console.error('Error starting analysis:', error);
    res.status(500).json({ 
      success: false, 
      error: `Analysis error: ${error.message}` 
    });
  }
});

// ============ NODULE ROUTES ============
app.post('/api/nodules', async (req, res) => {
  try {
    const id = await saveNodule(req.body);
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/studies/:studyId/nodules', async (req, res) => {
  try {
    const nodules = await getNodulesByStudy(req.params.studyId);
    res.json(nodules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/nodules/:id', async (req, res) => {
  try {
    const nodule = await getNodule(parseInt(req.params.id));
    if (nodule) {
      res.json(nodule);
    } else {
      res.status(404).json({ error: 'Nodule not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/nodules/:id', async (req, res) => {
  try {
    await updateNodule(parseInt(req.params.id), req.body);
    const updatedNodule = await getNodule(parseInt(req.params.id));
    res.json({ success: true, nodule: updatedNodule });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ USER ROUTES ============
app.post('/api/users', async (req, res) => {
  try {
    console.log('Received user data:', req.body);
    const id = await createUser(req.body);
    console.log('User created with ID:', id);
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error creating user:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await getUser(parseInt(req.params.id));
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/users/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    await updateUserStatus(parseInt(req.params.id), status);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/users/:id/profile', async (req, res) => {
  try {
    const updatedUser = await updateUserProfile(parseInt(req.params.id), req.body);
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await deleteUser(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete patient and all related data including physical DICOM files
app.delete('/api/patients/:id', async (req, res) => {
  try {
    const patientId = req.params.id;
    
    // First, get all study IDs for this patient to delete their DICOM folders
    const pool = await import('./database.js').then(m => m.getPool ? m.getPool() : null);
    if (pool) {
      const studiesResult = await pool.request()
        .input('patient_id', patientId)
        .query('SELECT study_id FROM studies WHERE patient_id = @patient_id');
      
      // Delete physical DICOM folders for each study
      for (const study of studiesResult.recordset) {
        const studyFolder = path.join(uploadsDir, study.study_id);
        if (fs.existsSync(studyFolder)) {
          fs.rmSync(studyFolder, { recursive: true, force: true });
          console.log(`Deleted DICOM folder: ${studyFolder}`);
        }
      }
    }
    
    // Delete from database
    const result = await deletePatient(patientId);
    if (result === 0) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }
    res.json({ success: true, message: 'Patient and all related data deleted' });
  } catch (error) {
    console.error('Error deleting patient:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete study and all related data including physical DICOM files
app.delete('/api/studies/:id', async (req, res) => {
  try {
    const studyId = req.params.id;
    
    // Delete physical DICOM folder
    const studyFolder = path.join(uploadsDir, studyId);
    if (fs.existsSync(studyFolder)) {
      fs.rmSync(studyFolder, { recursive: true, force: true });
      console.log(`Deleted DICOM folder: ${studyFolder}`);
    }
    
    // Delete from database (nodules, dicom_files, reports, study)
    const result = await deleteStudy(studyId);
    
    if (result === 0) {
      return res.status(404).json({ success: false, error: 'Study not found' });
    }
    res.json({ success: true, message: 'Study and all related data deleted' });
  } catch (error) {
    console.error('Error deleting study:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a single nodule
app.delete('/api/nodules/:id', async (req, res) => {
  try {
    const result = await deleteNodule(parseInt(req.params.id));
    if (result === 0) {
      return res.status(404).json({ success: false, error: 'Nodule not found' });
    }
    res.json({ success: true, message: 'Nodule deleted' });
  } catch (error) {
    console.error('Error deleting nodule:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ AUTH ROUTES ============
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await getUserByUsername(username);
    
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    
    if (user.password !== password) {
      return res.status(401).json({ success: false, error: 'Invalid password' });
    }
    
    if (user.status !== 'Active' && user.status !== 'Aktif') {
      return res.status(401).json({ success: false, error: 'Account is inactive' });
    }
    
    // Update last login
    await updateUserLastLogin(user.id);
    
    // Log activity
    await createActivityLog({
      user_id: user.id,
      username: user.username,
      action: 'Logged into system',
      action_type: 'login'
    });
    
    res.json({ 
      success: true, 
      user: {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        role: user.role,
        specialization: user.specialization,
        department: user.department,
        hospital: user.hospital,
        licenseNumber: user.license_number
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ DASHBOARD STATS ROUTES ============
app.get('/api/stats/dashboard', async (req, res) => {
  try {
    const stats = await getDashboardStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats/users', async (req, res) => {
  try {
    const stats = await getUserStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ACTIVITY LOG ROUTES ============
app.post('/api/activity-logs', async (req, res) => {
  try {
    const id = await createActivityLog(req.body);
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/activity-logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const logs = await getActivityLogs(limit);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/activity-logs/recent', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const logs = await getRecentActivityLogs(hours);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ REPORT ROUTES ============
app.post('/api/reports', async (req, res) => {
  try {
    const reportId = `RPT-${Date.now()}`;
    const reportData = {
      report_id: reportId,
      study_id: req.body.study_id,
      patient_id: req.body.patient_id,
      patient_name: req.body.patient_name,
      study_date: req.body.study_date,
      nodule_count: req.body.nodule_count,
      included_nodule_count: req.body.included_nodule_count,
      report_data: JSON.stringify(req.body.report_data),
      generated_by: req.body.generated_by,
      generated_by_id: req.body.generated_by_id
    };
    const report = await createReport(reportData);
    res.json({ success: true, report });
  } catch (error) {
    console.error('Error creating report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/reports', async (req, res) => {
  try {
    const userId = req.query.user_id;
    let reports;
    if (userId) {
      reports = await getReportsByUser(parseInt(userId));
    } else {
      reports = await getAllReports();
    }
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reports/:id', async (req, res) => {
  try {
    const report = await getReport(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/reports/:id', async (req, res) => {
  try {
    const result = await deleteReport(req.params.id);
    if (result === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initialize database and start server
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Server is listening on all network interfaces`);
  });
}).catch(error => {
  console.error('Failed to initialize database:', error);
  process.exit(1);
});
