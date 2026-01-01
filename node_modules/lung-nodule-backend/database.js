import sql from 'mssql/msnodesqlv8.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Validate required environment variables
const DB_SERVER = process.env.DB_SERVER;
const DB_DATABASE = process.env.DB_DATABASE || 'lung_nodule';

if (!DB_SERVER) {
  console.error('❌ ERROR: DB_SERVER is not defined in .env file');
  console.error('📋 Please create a .env file based on .env.example');
  console.error('');
  console.error('Steps:');
  console.error('1. Copy .env.example to .env');
  console.error('2. Set DB_SERVER to your SQL Server instance name');
  console.error('   Examples: .\\SQLEXPRESS, localhost\\SQLEXPRESS, BMD\\SQLEXPRESS01');
  process.exit(1);
}

// SQL Server configuration for master (to create database)
const masterConfig = {
  connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${DB_SERVER};Database=master;Trusted_Connection=yes;`,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

// SQL Server configuration for app database
const config = {
  connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${DB_SERVER};Database=${DB_DATABASE};Trusted_Connection=yes;`,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let pool = null;

// Create database if not exists
async function ensureDatabaseExists() {
  let masterPool = null;
  try {
    console.log('🔍 Checking if database exists...');
    masterPool = await sql.connect(masterConfig);
    
    // Check if database exists
    const result = await masterPool.request()
      .input('dbName', sql.NVarChar, DB_DATABASE)
      .query(`SELECT database_id FROM sys.databases WHERE name = @dbName`);
    
    if (result.recordset.length === 0) {
      console.log(`📦 Creating database "${DB_DATABASE}"...`);
      await masterPool.request().query(`CREATE DATABASE [${DB_DATABASE}]`);
      console.log(`✅ Database "${DB_DATABASE}" created successfully!`);
    } else {
      console.log(`✅ Database "${DB_DATABASE}" already exists`);
    }
    
    await masterPool.close();
  } catch (error) {
    if (masterPool) await masterPool.close();
    console.error('❌ Error checking/creating database:', error.message);
    throw error;
  }
}

// Veritabanı bağlantısını başlat
export async function initDatabase() {
  try {
    // First ensure database exists
    await ensureDatabaseExists();
    
    // Now connect to the app database
    pool = await sql.connect(config);
    console.log('✅ SQL Server baglantisi basarili!');
    console.log(`📊 Database: ${DB_DATABASE}`);
    console.log(`🖥️  Server: ${DB_SERVER}`);
    
    // Tabloları oluştur
    await createTables();
    
    return pool;
  } catch (error) {
    console.error('❌ SQL Server baglanti hatasi:', error.message);
    console.error('');
    console.error('🔍 Troubleshooting:');
    console.error('1. Make sure SQL Server is running');
    console.error('2. Verify DB_SERVER in .env file matches your SQL Server instance');
    console.error('3. Check that Windows Authentication is enabled');
    throw error;
  }
}

// Tabloları oluştur
async function createTables() {
  try {
    // Patients tablosu
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='patients' AND xtype='U')
      CREATE TABLE patients (
        id INT IDENTITY(1,1) PRIMARY KEY,
        patient_id NVARCHAR(50) UNIQUE NOT NULL,
        name NVARCHAR(100) NOT NULL,
        age INT,
        gender NVARCHAR(10),
        created_at DATETIME DEFAULT GETDATE()
      )
    `);

    // Studies tablosu
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='studies' AND xtype='U')
      CREATE TABLE studies (
        id INT IDENTITY(1,1) PRIMARY KEY,
        study_id NVARCHAR(50) UNIQUE NOT NULL,
        patient_id NVARCHAR(50) NOT NULL,
        study_date NVARCHAR(50),
        description NVARCHAR(255),
        clinical_note NVARCHAR(MAX),
        nodule_count INT DEFAULT 0,
        status NVARCHAR(20) DEFAULT 'pending',
        created_at DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
      )
    `);

    // DICOM files tablosu
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='dicom_files' AND xtype='U')
      CREATE TABLE dicom_files (
        id INT IDENTITY(1,1) PRIMARY KEY,
        study_id NVARCHAR(50) NOT NULL,
        file_path NVARCHAR(500) NOT NULL,
        file_name NVARCHAR(255) NOT NULL,
        instance_number INT,
        uploaded_at DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (study_id) REFERENCES studies(study_id)
      )
    `);

    // Nodules tablosu
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='nodules' AND xtype='U')
      CREATE TABLE nodules (
        id INT IDENTITY(1,1) PRIMARY KEY,
        study_id NVARCHAR(50) NOT NULL,
        nodule_number INT,
        location NVARCHAR(100),
        size_mm FLOAT,
        risk_level NVARCHAR(20),
        coordinates NVARCHAR(MAX),
        slice_index INT,
        probability FLOAT,
        doctor_assessment NVARCHAR(50),
        notes NVARCHAR(MAX),
        include_in_report BIT DEFAULT 1,
        reviewed BIT DEFAULT 0,
        created_at DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (study_id) REFERENCES studies(study_id)
      )
    `);

    // Reports tablosu
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='reports' AND xtype='U')
      CREATE TABLE reports (
        id INT IDENTITY(1,1) PRIMARY KEY,
        report_id NVARCHAR(50) UNIQUE NOT NULL,
        study_id NVARCHAR(50) NOT NULL,
        patient_id NVARCHAR(50) NOT NULL,
        patient_name NVARCHAR(100),
        study_date NVARCHAR(50),
        nodule_count INT DEFAULT 0,
        included_nodule_count INT DEFAULT 0,
        report_data NVARCHAR(MAX),
        generated_by NVARCHAR(100),
        generated_by_id INT,
        status NVARCHAR(20) DEFAULT 'completed',
        created_at DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (study_id) REFERENCES studies(study_id)
      )
    `);

    // Users tablosu
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
      CREATE TABLE users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        username NVARCHAR(50) UNIQUE NOT NULL,
        password NVARCHAR(255) NOT NULL,
        first_name NVARCHAR(50) NOT NULL,
        last_name NVARCHAR(50) NOT NULL,
        email NVARCHAR(100) UNIQUE NOT NULL,
        role NVARCHAR(20) NOT NULL DEFAULT 'Doctor',
        status NVARCHAR(20) NOT NULL DEFAULT 'Active',
        specialization NVARCHAR(100),
        department NVARCHAR(100),
        hospital NVARCHAR(200),
        license_number NVARCHAR(50),
        last_login DATETIME,
        created_at DATETIME DEFAULT GETDATE()
      )
    `);
    
    // Add new columns if they don't exist (for existing tables)
    
    // Users table columns
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'specialization')
      ALTER TABLE users ADD specialization NVARCHAR(100)
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'department')
      ALTER TABLE users ADD department NVARCHAR(100)
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'hospital')
      ALTER TABLE users ADD hospital NVARCHAR(200)
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'license_number')
      ALTER TABLE users ADD license_number NVARCHAR(50)
    `);
    
    // Studies table columns
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('studies') AND name = 'clinical_note')
      ALTER TABLE studies ADD clinical_note NVARCHAR(MAX)
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('studies') AND name = 'reviewed')
      ALTER TABLE studies ADD reviewed BIT DEFAULT 0
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('studies') AND name = 'reviewed_at')
      ALTER TABLE studies ADD reviewed_at DATETIME
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('studies') AND name = 'reviewed_by')
      ALTER TABLE studies ADD reviewed_by INT
    `);
    
    // Nodules table columns
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('nodules') AND name = 'slice_index')
      ALTER TABLE nodules ADD slice_index INT
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('nodules') AND name = 'probability')
      ALTER TABLE nodules ADD probability FLOAT
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('nodules') AND name = 'doctor_assessment')
      ALTER TABLE nodules ADD doctor_assessment NVARCHAR(50)
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('nodules') AND name = 'notes')
      ALTER TABLE nodules ADD notes NVARCHAR(MAX)
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('nodules') AND name = 'include_in_report')
      ALTER TABLE nodules ADD include_in_report BIT DEFAULT 1
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('nodules') AND name = 'reviewed')
      ALTER TABLE nodules ADD reviewed BIT DEFAULT 0
    `);

    // Default admin user (if not exists)
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM users WHERE username = 'admin')
      INSERT INTO users (username, password, first_name, last_name, email, role, status, department)
      VALUES ('admin', 'admin123', 'System', 'Admin', 'admin@hospital.com', 'Admin', 'Active', 'IT Department')
    `);

    // Default doctor user (if not exists)
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM users WHERE username = 'doctor')
      INSERT INTO users (username, password, first_name, last_name, email, role, status, specialization, department, hospital, license_number)
      VALUES ('doctor', 'doctor123', 'Demo', 'Doctor', 'doctor@hospital.com', 'Doctor', 'Active', 'Radiology', 'Radiology Department', 'Medical Center Hospital', 'MD-123456')
    `);

    // Activity logs tablosu
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='activity_logs' AND xtype='U')
      CREATE TABLE activity_logs (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT,
        username NVARCHAR(50),
        action NVARCHAR(255),
        action_type NVARCHAR(50),
        details NVARCHAR(MAX),
        created_at DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    console.log('Tablolar basariyla olusturuldu/kontrol edildi');
    console.log('Varsayilan kullanicilar kontrol edildi');
    console.log('Ornek hastalar ve calismalar kontrol edildi');
  } catch (error) {
    console.error('Tablo olusturma hatasi:', error.message);
    throw error;
  }
}

// Bağlantı havuzunu al
export function getPool() {
  return pool;
}

// Bağlantıyı kapat
export async function closeDatabase() {
  if (pool) {
    await pool.close();
    console.log('SQL Server bağlantısı kapatıldı');
  }
}

// ============ PATIENT OPERATIONS ============

export async function createPatient(patientData) {
  const { patient_id, name, age, gender } = patientData;
  const result = await pool.request()
    .input('patient_id', sql.NVarChar, patient_id)
    .input('name', sql.NVarChar, name)
    .input('age', sql.Int, age)
    .input('gender', sql.NVarChar, gender)
    .query(`
      INSERT INTO patients (patient_id, name, age, gender)
      OUTPUT INSERTED.id
      VALUES (@patient_id, @name, @age, @gender)
    `);
  return result.recordset[0].id;
}

export async function getPatient(patientId) {
  const result = await pool.request()
    .input('patient_id', sql.NVarChar, patientId)
    .query('SELECT * FROM patients WHERE patient_id = @patient_id');
  return result.recordset[0];
}

export async function getAllPatients() {
  const result = await pool.request()
    .query('SELECT * FROM patients ORDER BY created_at DESC');
  return result.recordset;
}

export async function deletePatient(patientId) {
  // Delete in order: nodules -> dicom_files -> reports -> studies -> patient
  await pool.request()
    .input('patient_id', sql.NVarChar, patientId)
    .query(`DELETE FROM nodules WHERE study_id IN (SELECT study_id FROM studies WHERE patient_id = @patient_id)`);
  
  await pool.request()
    .input('patient_id', sql.NVarChar, patientId)
    .query(`DELETE FROM dicom_files WHERE study_id IN (SELECT study_id FROM studies WHERE patient_id = @patient_id)`);
  
  await pool.request()
    .input('patient_id', sql.NVarChar, patientId)
    .query(`DELETE FROM reports WHERE patient_id = @patient_id`);
  
  await pool.request()
    .input('patient_id', sql.NVarChar, patientId)
    .query(`DELETE FROM studies WHERE patient_id = @patient_id`);
  
  const result = await pool.request()
    .input('patient_id', sql.NVarChar, patientId)
    .query(`DELETE FROM patients WHERE patient_id = @patient_id`);
  
  return result.rowsAffected[0];
}

// ============ STUDY ISLEMLERI ============

export async function createStudy(studyData) {
  const { study_id, patient_id, study_date, description, clinical_note } = studyData;
  const result = await pool.request()
    .input('study_id', sql.NVarChar, study_id)
    .input('patient_id', sql.NVarChar, patient_id)
    .input('study_date', sql.NVarChar, study_date)
    .input('description', sql.NVarChar, description)
    .input('clinical_note', sql.NVarChar, clinical_note || null)
    .query(`
      INSERT INTO studies (study_id, patient_id, study_date, description, clinical_note)
      OUTPUT INSERTED.id
      VALUES (@study_id, @patient_id, @study_date, @description, @clinical_note)
    `);
  return result.recordset[0].id;
}

export async function getStudy(studyId) {
  const result = await pool.request()
    .input('study_id', sql.NVarChar, studyId)
    .query(`
      SELECT s.*, p.name as patient_name, p.age as patient_age, p.gender as patient_gender 
      FROM studies s 
      LEFT JOIN patients p ON s.patient_id = p.patient_id 
      WHERE s.study_id = @study_id
    `);
  return result.recordset[0];
}

export async function getAllStudies() {
  const result = await pool.request()
    .query(`
      SELECT s.*, p.name as patient_name 
      FROM studies s 
      LEFT JOIN patients p ON s.patient_id = p.patient_id 
      ORDER BY s.created_at DESC
    `);
  return result.recordset;
}

export async function updateStudyStatus(studyId, status, noduleCount) {
  await pool.request()
    .input('study_id', sql.NVarChar, studyId)
    .input('status', sql.NVarChar, status)
    .input('nodule_count', sql.Int, noduleCount)
    .query(`
      UPDATE studies 
      SET status = @status, nodule_count = @nodule_count 
      WHERE study_id = @study_id
    `);
}

export async function markStudyAsReviewed(studyId, userId) {
  await pool.request()
    .input('study_id', sql.NVarChar, studyId)
    .input('reviewed_by', sql.Int, userId || null)
    .query(`
      UPDATE studies 
      SET reviewed = 1, reviewed_at = GETDATE(), reviewed_by = @reviewed_by 
      WHERE study_id = @study_id
    `);
}

// Delete study and all related data (nodules, dicom_files, reports)
export async function deleteStudy(studyId) {
  // Delete in order: nodules -> dicom_files -> reports -> study
  await pool.request()
    .input('study_id', sql.NVarChar, studyId)
    .query(`DELETE FROM nodules WHERE study_id = @study_id`);
  
  await pool.request()
    .input('study_id', sql.NVarChar, studyId)
    .query(`DELETE FROM dicom_files WHERE study_id = @study_id`);
  
  await pool.request()
    .input('study_id', sql.NVarChar, studyId)
    .query(`DELETE FROM reports WHERE study_id = @study_id`);
  
  const result = await pool.request()
    .input('study_id', sql.NVarChar, studyId)
    .query(`DELETE FROM studies WHERE study_id = @study_id`);
  
  return result.rowsAffected[0];
}

// ============ DICOM FILE OPERATIONS ============

export async function saveDicomFile(fileData) {
  const { study_id, file_path, file_name, instance_number } = fileData;
  const result = await pool.request()
    .input('study_id', sql.NVarChar, study_id)
    .input('file_path', sql.NVarChar, file_path)
    .input('file_name', sql.NVarChar, file_name)
    .input('instance_number', sql.Int, instance_number)
    .query(`
      INSERT INTO dicom_files (study_id, file_path, file_name, instance_number)
      OUTPUT INSERTED.id
      VALUES (@study_id, @file_path, @file_name, @instance_number)
    `);
  return result.recordset[0].id;
}

export async function getDicomFilesByStudy(studyId) {
  const result = await pool.request()
    .input('study_id', sql.NVarChar, studyId)
    .query('SELECT * FROM dicom_files WHERE study_id = @study_id ORDER BY instance_number');
  return result.recordset;
}

// ============ NODULE ISLEMLERI ============

export async function saveNodule(noduleData) {
  const { study_id, nodule_number, location, size_mm, risk_level, coordinates, slice_index, probability, doctor_assessment, notes, include_in_report, reviewed } = noduleData;
  const result = await pool.request()
    .input('study_id', sql.NVarChar, study_id)
    .input('nodule_number', sql.Int, nodule_number)
    .input('location', sql.NVarChar, location)
    .input('size_mm', sql.Float, size_mm)
    .input('risk_level', sql.NVarChar, risk_level)
    .input('coordinates', sql.NVarChar, typeof coordinates === 'string' ? coordinates : JSON.stringify(coordinates))
    .input('slice_index', sql.Int, slice_index || null)
    .input('probability', sql.Float, probability || null)
    .input('doctor_assessment', sql.NVarChar, doctor_assessment || null)
    .input('notes', sql.NVarChar, notes || null)
    .input('include_in_report', sql.Bit, include_in_report !== false ? 1 : 0)
    .input('reviewed', sql.Bit, reviewed ? 1 : 0)
    .query(`
      INSERT INTO nodules (study_id, nodule_number, location, size_mm, risk_level, coordinates, slice_index, probability, doctor_assessment, notes, include_in_report, reviewed)
      OUTPUT INSERTED.id
      VALUES (@study_id, @nodule_number, @location, @size_mm, @risk_level, @coordinates, @slice_index, @probability, @doctor_assessment, @notes, @include_in_report, @reviewed)
    `);
  return result.recordset[0].id;
}

export async function getNodulesByStudy(studyId) {
  const result = await pool.request()
    .input('study_id', sql.NVarChar, studyId)
    .query('SELECT * FROM nodules WHERE study_id = @study_id ORDER BY nodule_number');
  return result.recordset;
}

export async function updateNodule(noduleId, updateData) {
  const { location, size_mm, risk_level, slice_index, probability, doctor_assessment, notes, include_in_report, reviewed } = updateData;
  
  // Build dynamic update query
  const updates = [];
  const request = pool.request().input('id', sql.Int, noduleId);
  
  if (location !== undefined) {
    updates.push('location = @location');
    request.input('location', sql.NVarChar, location);
  }
  if (size_mm !== undefined) {
    updates.push('size_mm = @size_mm');
    request.input('size_mm', sql.Float, size_mm);
  }
  if (risk_level !== undefined) {
    updates.push('risk_level = @risk_level');
    request.input('risk_level', sql.NVarChar, risk_level);
  }
  if (slice_index !== undefined) {
    updates.push('slice_index = @slice_index');
    request.input('slice_index', sql.Int, slice_index);
  }
  if (probability !== undefined) {
    updates.push('probability = @probability');
    request.input('probability', sql.Float, probability);
  }
  if (doctor_assessment !== undefined) {
    updates.push('doctor_assessment = @doctor_assessment');
    request.input('doctor_assessment', sql.NVarChar, doctor_assessment);
  }
  if (notes !== undefined) {
    updates.push('notes = @notes');
    request.input('notes', sql.NVarChar, notes);
  }
  if (include_in_report !== undefined) {
    updates.push('include_in_report = @include_in_report');
    request.input('include_in_report', sql.Bit, include_in_report ? 1 : 0);
  }
  if (reviewed !== undefined) {
    updates.push('reviewed = @reviewed');
    request.input('reviewed', sql.Bit, reviewed ? 1 : 0);
  }
  
  if (updates.length > 0) {
    await request.query(`UPDATE nodules SET ${updates.join(', ')} WHERE id = @id`);
  }
}

export async function getNodule(noduleId) {
  const result = await pool.request()
    .input('id', sql.Int, noduleId)
    .query('SELECT * FROM nodules WHERE id = @id');
  return result.recordset[0];
}

// Delete a single nodule
export async function deleteNodule(noduleId) {
  const result = await pool.request()
    .input('id', sql.Int, noduleId)
    .query('DELETE FROM nodules WHERE id = @id');
  return result.rowsAffected[0];
}

// Delete all nodules for a study
export async function deleteNodulesByStudy(studyId) {
  const result = await pool.request()
    .input('study_id', sql.NVarChar, studyId)
    .query('DELETE FROM nodules WHERE study_id = @study_id');
  return result.rowsAffected[0];
}

// ============ USER ISLEMLERI ============

export async function createUser(userData) {
  const { username, password, first_name, last_name, email, role } = userData;
  const result = await pool.request()
    .input('username', sql.NVarChar, username)
    .input('password', sql.NVarChar, password)
    .input('first_name', sql.NVarChar, first_name)
    .input('last_name', sql.NVarChar, last_name)
    .input('email', sql.NVarChar, email)
    .input('role', sql.NVarChar, role || 'Doctor')
    .query(`
      INSERT INTO users (username, password, first_name, last_name, email, role, status)
      OUTPUT INSERTED.id
      VALUES (@username, @password, @first_name, @last_name, @email, @role, 'Active')
    `);
  return result.recordset[0].id;
}

export async function getUser(userId) {
  const result = await pool.request()
    .input('id', sql.Int, userId)
    .query('SELECT id, username, first_name, last_name, email, role, status, last_login, created_at FROM users WHERE id = @id');
  return result.recordset[0];
}

export async function getUserByUsername(username) {
  const result = await pool.request()
    .input('username', sql.NVarChar, username)
    .query('SELECT * FROM users WHERE username = @username');
  return result.recordset[0];
}

export async function getAllUsers() {
  const result = await pool.request()
    .query('SELECT id, username, first_name, last_name, email, role, status, last_login, created_at FROM users ORDER BY created_at DESC');
  return result.recordset;
}

export async function updateUserStatus(userId, status) {
  await pool.request()
    .input('id', sql.Int, userId)
    .input('status', sql.NVarChar, status)
    .query('UPDATE users SET status = @status WHERE id = @id');
}

export async function updateUserLastLogin(userId) {
  await pool.request()
    .input('id', sql.Int, userId)
    .query('UPDATE users SET last_login = GETDATE() WHERE id = @id');
}

export async function deleteUser(userId) {
  // First delete activity logs for this user
  await pool.request()
    .input('id', sql.Int, userId)
    .query('DELETE FROM activity_logs WHERE user_id = @id');
  
  // Then delete the user
  await pool.request()
    .input('id', sql.Int, userId)
    .query('DELETE FROM users WHERE id = @id');
}

export async function updateUserProfile(userId, profileData) {
  const { first_name, last_name, email, specialization, department, hospital, license_number } = profileData;
  await pool.request()
    .input('id', sql.Int, userId)
    .input('first_name', sql.NVarChar, first_name)
    .input('last_name', sql.NVarChar, last_name)
    .input('email', sql.NVarChar, email)
    .input('specialization', sql.NVarChar, specialization || null)
    .input('department', sql.NVarChar, department || null)
    .input('hospital', sql.NVarChar, hospital || null)
    .input('license_number', sql.NVarChar, license_number || null)
    .query(`UPDATE users SET 
      first_name = @first_name, 
      last_name = @last_name, 
      email = @email,
      specialization = @specialization,
      department = @department,
      hospital = @hospital,
      license_number = @license_number
    WHERE id = @id`);
  
  // Return updated user
  const result = await pool.request()
    .input('id', sql.Int, userId)
    .query('SELECT id, username, first_name, last_name, email, role, specialization, department, hospital, license_number FROM users WHERE id = @id');
  return result.recordset[0];
}

// ============ STATISTICS OPERATIONS ============

export async function getDashboardStats() {
  const result = await pool.request().query(`
    SELECT 
      (SELECT COUNT(*) FROM users) as totalUsers,
      (SELECT COUNT(*) FROM users WHERE role = 'Doctor') as doctorCount,
      (SELECT COUNT(*) FROM users WHERE role = 'Admin') as adminCount,
      (SELECT COUNT(*) FROM patients) as totalPatients,
      (SELECT COUNT(*) FROM studies) as totalStudies,
      (SELECT COUNT(*) FROM studies WHERE status = 'completed') as completedStudies,
      (SELECT COUNT(*) FROM studies WHERE status = 'pending') as pendingStudies,
      (SELECT COUNT(*) FROM users WHERE last_login >= DATEADD(hour, -24, GETDATE())) as last24hLogins
  `);
  return result.recordset[0];
}

export async function getUserStats() {
  const result = await pool.request().query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN role = 'Doctor' THEN 1 ELSE 0 END) as doctors,
      SUM(CASE WHEN role = 'Admin' THEN 1 ELSE 0 END) as admins,
      SUM(CASE WHEN status IN ('Active', 'Aktif') THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status IN ('Inactive', 'Pasif') THEN 1 ELSE 0 END) as inactive
    FROM users
  `);
  return result.recordset[0];
}

// ============ ACTIVITY LOG OPERATIONS ============

export async function createActivityLog(logData) {
  const { user_id, username, action, action_type, details } = logData;
  const result = await pool.request()
    .input('user_id', sql.Int, user_id)
    .input('username', sql.NVarChar, username)
    .input('action', sql.NVarChar, action)
    .input('action_type', sql.NVarChar, action_type)
    .input('details', sql.NVarChar, details || '')
    .query(`
      INSERT INTO activity_logs (user_id, username, action, action_type, details)
      OUTPUT INSERTED.id
      VALUES (@user_id, @username, @action, @action_type, @details)
    `);
  return result.recordset[0].id;
}

export async function getActivityLogs(limit = 50) {
  const result = await pool.request()
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit) * FROM activity_logs 
      ORDER BY created_at DESC
    `);
  return result.recordset;
}

export async function getRecentActivityLogs(hours = 24) {
  const result = await pool.request()
    .input('hours', sql.Int, hours)
    .query(`
      SELECT * FROM activity_logs 
      WHERE created_at >= DATEADD(hour, -@hours, GETDATE())
      ORDER BY created_at DESC
    `);
  return result.recordset;
}

// ============ REPORT OPERATIONS ============

export async function createReport(reportData) {
  const { report_id, study_id, patient_id, patient_name, study_date, nodule_count, included_nodule_count, report_data, generated_by, generated_by_id } = reportData;
  const result = await pool.request()
    .input('report_id', sql.NVarChar, report_id)
    .input('study_id', sql.NVarChar, study_id)
    .input('patient_id', sql.NVarChar, patient_id)
    .input('patient_name', sql.NVarChar, patient_name)
    .input('study_date', sql.NVarChar, study_date)
    .input('nodule_count', sql.Int, nodule_count)
    .input('included_nodule_count', sql.Int, included_nodule_count)
    .input('report_data', sql.NVarChar, report_data)
    .input('generated_by', sql.NVarChar, generated_by)
    .input('generated_by_id', sql.Int, generated_by_id)
    .query(`
      INSERT INTO reports (report_id, study_id, patient_id, patient_name, study_date, nodule_count, included_nodule_count, report_data, generated_by, generated_by_id)
      OUTPUT INSERTED.*
      VALUES (@report_id, @study_id, @patient_id, @patient_name, @study_date, @nodule_count, @included_nodule_count, @report_data, @generated_by, @generated_by_id)
    `);
  return result.recordset[0];
}

export async function getReport(report_id) {
  const result = await pool.request()
    .input('report_id', sql.NVarChar, report_id)
    .query('SELECT * FROM reports WHERE report_id = @report_id');
  return result.recordset[0];
}

export async function getAllReports() {
  const result = await pool.request()
    .query('SELECT * FROM reports ORDER BY created_at DESC');
  return result.recordset;
}

export async function getReportsByUser(generated_by_id) {
  const result = await pool.request()
    .input('generated_by_id', sql.Int, generated_by_id)
    .query('SELECT * FROM reports WHERE generated_by_id = @generated_by_id ORDER BY created_at DESC');
  return result.recordset;
}

export async function deleteReport(report_id) {
  const result = await pool.request()
    .input('report_id', sql.NVarChar, report_id)
    .query('DELETE FROM reports WHERE report_id = @report_id');
  return result.rowsAffected[0];
}

export default {
  initDatabase,
  closeDatabase,
  getPool,
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
};
