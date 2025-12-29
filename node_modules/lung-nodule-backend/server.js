import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  initDatabase,
  createPatient,
  getPatient,
  getAllPatients,
  createStudy,
  getStudy,
  getAllStudies,
  updateStudyStatus,
  saveDicomFile,
  getDicomFilesByStudy,
  saveNodule,
  getNodulesByStudy
} from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded files statically
app.use('/uploads', express.static(uploadsDir));

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

// Patient routes
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

// Study routes
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

// DICOM upload route
app.post('/api/upload-dicom', upload.array('dicomFiles', 500), async (req, res) => {
  try {
    const { study_id } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Save file info to database
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

// Get DICOM files for a study
app.get('/api/studies/:studyId/dicom-files', async (req, res) => {
  try {
    const files = await getDicomFilesByStudy(req.params.studyId);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Nodule routes
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