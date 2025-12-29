import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const db = new sqlite3.Database('./lung_nodule.db');

// Promisify database methods
const dbRun = promisify(db.run.bind(db));
const dbAll = promisify(db.all.bind(db));
const dbGet = promisify(db.get.bind(db));

// Initialize database tables
export async function initDatabase() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      age INTEGER,
      gender TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS studies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      study_id TEXT UNIQUE NOT NULL,
      patient_id TEXT NOT NULL,
      study_date TEXT,
      description TEXT,
      nodule_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS dicom_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      study_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      instance_number INTEGER,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (study_id) REFERENCES studies(study_id)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS nodules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      study_id TEXT NOT NULL,
      nodule_number INTEGER,
      location TEXT,
      size_mm REAL,
      risk_level TEXT,
      coordinates TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (study_id) REFERENCES studies(study_id)
    )
  `);

  console.log('Database initialized successfully');
}

// Patient operations
export async function createPatient(patientData) {
  const { patient_id, name, age, gender } = patientData;
  const result = await dbRun(
    'INSERT INTO patients (patient_id, name, age, gender) VALUES (?, ?, ?, ?)',
    [patient_id, name, age, gender]
  );
  return result.lastID;
}

export async function getPatient(patientId) {
  return await dbGet('SELECT * FROM patients WHERE patient_id = ?', [patientId]);
}

export async function getAllPatients() {
  return await dbAll('SELECT * FROM patients ORDER BY created_at DESC');
}

// Study operations
export async function createStudy(studyData) {
  const { study_id, patient_id, study_date, description } = studyData;
  const result = await dbRun(
    'INSERT INTO studies (study_id, patient_id, study_date, description) VALUES (?, ?, ?, ?)',
    [study_id, patient_id, study_date, description]
  );
  return result.lastID;
}

export async function getStudy(studyId) {
  return await dbGet('SELECT * FROM studies WHERE study_id = ?', [studyId]);
}

export async function getAllStudies() {
  return await dbAll(`
    SELECT s.*, p.name as patient_name, p.age, p.gender
    FROM studies s
    JOIN patients p ON s.patient_id = p.patient_id
    ORDER BY s.created_at DESC
  `);
}

export async function updateStudyStatus(studyId, status, noduleCount) {
  await dbRun(
    'UPDATE studies SET status = ?, nodule_count = ? WHERE study_id = ?',
    [status, noduleCount, studyId]
  );
}

// DICOM file operations
export async function saveDicomFile(fileData) {
  const { study_id, file_path, file_name, instance_number } = fileData;
  const result = await dbRun(
    'INSERT INTO dicom_files (study_id, file_path, file_name, instance_number) VALUES (?, ?, ?, ?)',
    [study_id, file_path, file_name, instance_number]
  );
  return result.lastID;
}

export async function getDicomFilesByStudy(studyId) {
  return await dbAll(
    'SELECT * FROM dicom_files WHERE study_id = ? ORDER BY instance_number',
    [studyId]
  );
}

// Nodule operations
export async function saveNodule(noduleData) {
  const { study_id, nodule_number, location, size_mm, risk_level, coordinates } = noduleData;
  const result = await dbRun(
    'INSERT INTO nodules (study_id, nodule_number, location, size_mm, risk_level, coordinates) VALUES (?, ?, ?, ?, ?, ?)',
    [study_id, nodule_number, location, size_mm, risk_level, JSON.stringify(coordinates)]
  );
  return result.lastID;
}

export async function getNodulesByStudy(studyId) {
  return await dbAll('SELECT * FROM nodules WHERE study_id = ?', [studyId]);
}

export { db };
