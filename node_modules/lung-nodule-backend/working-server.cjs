const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Database setup
const db = new sqlite3.Database('./lung_nodule.db', (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Database connected');
    initDatabase();
  }
});

function initDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      age INTEGER,
      gender TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS studies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      study_id TEXT UNIQUE NOT NULL,
      patient_id TEXT NOT NULL,
      study_date TEXT,
      description TEXT,
      nodule_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS dicom_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      study_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      instance_number INTEGER,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (study_id) REFERENCES studies(study_id)
    )`);

    console.log('Database tables created/verified');
  });
}

// Upload directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Multer config
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

app.get('/api/health', (req, res) => {
  console.log('Health check received');
  res.json({ status: 'ok', message: 'Server is running' });
});

app.post('/api/patients', (req, res) => {
  console.log('Patient data received:', req.body);
  const { patient_id, name, age, gender } = req.body;
  
  const sql = 'INSERT INTO patients (patient_id, name, age, gender) VALUES (?, ?, ?, ?)';
  db.run(sql, [patient_id, name, age, gender], function(err) {
    if (err) {
      console.error('Error inserting patient:', err.message);
      if (err.message.includes('UNIQUE constraint')) {
        res.json({ success: true, id: -1, message: 'Patient already exists' });
      } else {
        res.status(500).json({ success: false, error: err.message });
      }
    } else {
      console.log('Patient created with ID:', this.lastID);
      res.json({ success: true, id: this.lastID });
    }
  });
});

app.post('/api/studies', (req, res) => {
  console.log('Study data received:', req.body);
  const { study_id, patient_id, study_date, description } = req.body;
  
  const sql = 'INSERT INTO studies (study_id, patient_id, study_date, description) VALUES (?, ?, ?, ?)';
  db.run(sql, [study_id, patient_id, study_date, description], function(err) {
    if (err) {
      console.error('Error inserting study:', err.message);
      res.status(500).json({ success: false, error: err.message });
    } else {
      console.log('Study created with ID:', this.lastID);
      res.json({ success: true, id: this.lastID });
    }
  });
});

app.get('/api/studies', (req, res) => {
  const sql = `SELECT s.*, p.name as patient_name, p.age, p.gender
               FROM studies s
               JOIN patients p ON s.patient_id = p.patient_id
               ORDER BY s.created_at DESC`;
  
  db.all(sql, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/studies/:studyId', (req, res) => {
  const studySql = 'SELECT * FROM studies WHERE study_id = ?';
  const filesSql = 'SELECT * FROM dicom_files WHERE study_id = ? ORDER BY instance_number';
  
  db.get(studySql, [req.params.studyId], (err, study) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else if (!study) {
      res.status(404).json({ error: 'Study not found' });
    } else {
      // Get DICOM files for this study
      db.all(filesSql, [req.params.studyId], (err, files) => {
        if (err) {
          console.error('Error fetching DICOM files:', err);
          res.json({ ...study, dicomFiles: [] });
        } else {
          console.log(`Found ${files.length} DICOM files for study ${req.params.studyId}`);
          res.json({ ...study, dicomFiles: files });
        }
      });
    }
  });
});

app.put('/api/studies/:studyId/status', (req, res) => {
  const { status, noduleCount } = req.body;
  const sql = 'UPDATE studies SET status = ?, nodule_count = ? WHERE study_id = ?';
  
  db.run(sql, [status, noduleCount, req.params.studyId], function(err) {
    if (err) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json({ success: true });
    }
  });
});

app.post('/api/upload-dicom', upload.array('dicomFiles', 500), (req, res) => {
  console.log('DICOM upload received:', req.files?.length || 0, 'files');
  const { study_id } = req.body;
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const savedFiles = [];
  let completed = 0;

  files.forEach((file, i) => {
    const sql = 'INSERT INTO dicom_files (study_id, file_path, file_name, instance_number) VALUES (?, ?, ?, ?)';
    const filePath = `/uploads/${study_id}/${file.filename}`;
    
    db.run(sql, [study_id, filePath, file.filename, i + 1], (err) => {
      if (err) {
        console.error('Error saving file info:', err);
      } else {
        savedFiles.push({ file_path: filePath, file_name: file.filename });
      }
      
      completed++;
      if (completed === files.length) {
        res.json({
          success: true,
          message: `${files.length} DICOM files uploaded`,
          files: savedFiles
        });
      }
    });
  });
});

app.get('/api/studies/:studyId/dicom-files', (req, res) => {
  const sql = 'SELECT * FROM dicom_files WHERE study_id = ? ORDER BY instance_number';
  db.all(sql, [req.params.studyId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Database backend ready`);
});
