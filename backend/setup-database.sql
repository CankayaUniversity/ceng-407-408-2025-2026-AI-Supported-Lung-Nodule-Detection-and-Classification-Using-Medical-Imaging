IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'lung_nodule')
BEGIN
    CREATE DATABASE lung_nodule;
END
GO

USE lung_nodule;
GO

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
);
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='patients' AND xtype='U')
CREATE TABLE patients (
    id INT IDENTITY(1,1) PRIMARY KEY,
    patient_id NVARCHAR(50) UNIQUE NOT NULL,
    name NVARCHAR(100) NOT NULL,
    age INT,
    gender NVARCHAR(10),
    created_at DATETIME DEFAULT GETDATE()
);
GO

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
    reviewed BIT DEFAULT 0,
    reviewed_at DATETIME,
    reviewed_by INT,
    created_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_studies_patient FOREIGN KEY (patient_id) 
        REFERENCES patients(patient_id) ON DELETE CASCADE,
    CONSTRAINT FK_studies_reviewer FOREIGN KEY (reviewed_by) 
        REFERENCES users(id) ON DELETE SET NULL
);
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='dicom_files' AND xtype='U')
CREATE TABLE dicom_files (
    id INT IDENTITY(1,1) PRIMARY KEY,
    study_id NVARCHAR(50) NOT NULL,
    file_path NVARCHAR(500) NOT NULL,
    file_name NVARCHAR(255) NOT NULL,
    instance_number INT,
    uploaded_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_dicom_files_study FOREIGN KEY (study_id) 
        REFERENCES studies(study_id) ON DELETE CASCADE
);
GO

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
    CONSTRAINT FK_nodules_study FOREIGN KEY (study_id) 
        REFERENCES studies(study_id) ON DELETE CASCADE
);
GO

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
    CONSTRAINT FK_reports_study FOREIGN KEY (study_id) 
        REFERENCES studies(study_id) ON DELETE CASCADE,
    CONSTRAINT FK_reports_patient FOREIGN KEY (patient_id) 
        REFERENCES patients(patient_id) ON DELETE CASCADE,
    CONSTRAINT FK_reports_user FOREIGN KEY (generated_by_id) 
        REFERENCES users(id) ON DELETE SET NULL
);
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='activity_logs' AND xtype='U')
CREATE TABLE activity_logs (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT,
    username NVARCHAR(50),
    action NVARCHAR(255),
    action_type NVARCHAR(50),
    details NVARCHAR(MAX),
    created_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_activity_logs_user FOREIGN KEY (user_id) 
        REFERENCES users(id) ON DELETE SET NULL
);
GO

IF NOT EXISTS (SELECT * FROM users WHERE username = 'admin')
INSERT INTO users (username, password, first_name, last_name, email, role, status, department)
VALUES ('admin', 'admin123', 'System', 'Admin', 'admin@hospital.com', 'Admin', 'Active', 'IT Department');

IF NOT EXISTS (SELECT * FROM users WHERE username = 'doctor')
INSERT INTO users (username, password, first_name, last_name, email, role, status, specialization, department, hospital, license_number)
VALUES ('doctor', 'doctor123', 'Demo', 'Doctor', 'doctor@hospital.com', 'Doctor', 'Active', 'Radiology', 'Radiology Department', 'Medical Center Hospital', 'MD-123456');

GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_studies_patient_id')
    CREATE INDEX IX_studies_patient_id ON studies(patient_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_studies_status')
    CREATE INDEX IX_studies_status ON studies(status);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_studies_reviewed_by')
    CREATE INDEX IX_studies_reviewed_by ON studies(reviewed_by);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_dicom_files_study_id')
    CREATE INDEX IX_dicom_files_study_id ON dicom_files(study_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_nodules_study_id')
    CREATE INDEX IX_nodules_study_id ON nodules(study_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_nodules_risk_level')
    CREATE INDEX IX_nodules_risk_level ON nodules(risk_level);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_reports_study_id')
    CREATE INDEX IX_reports_study_id ON reports(study_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_reports_patient_id')
    CREATE INDEX IX_reports_patient_id ON reports(patient_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_activity_logs_user_id')
    CREATE INDEX IX_activity_logs_user_id ON activity_logs(user_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_activity_logs_action_type')
    CREATE INDEX IX_activity_logs_action_type ON activity_logs(action_type);

GO
