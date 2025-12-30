-- SQL Server'da lung_nodule veritabanını oluşturmak için bu scripti çalıştırın
-- SQL Server Management Studio (SSMS) veya sqlcmd ile çalıştırabilirsiniz

-- Veritabanı oluştur
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'lung_nodule')
BEGIN
    CREATE DATABASE lung_nodule;
    PRINT 'lung_nodule veritabanı oluşturuldu!';
END
ELSE
BEGIN
    PRINT 'lung_nodule veritabanı zaten mevcut.';
END
GO

USE lung_nodule;
GO

-- Patients tablosu
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

-- Studies tablosu
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='studies' AND xtype='U')
CREATE TABLE studies (
    id INT IDENTITY(1,1) PRIMARY KEY,
    study_id NVARCHAR(50) UNIQUE NOT NULL,
    patient_id NVARCHAR(50) NOT NULL,
    study_date NVARCHAR(50),
    description NVARCHAR(255),
    nodule_count INT DEFAULT 0,
    status NVARCHAR(20) DEFAULT 'pending',
    created_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
);
GO

-- DICOM files tablosu
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='dicom_files' AND xtype='U')
CREATE TABLE dicom_files (
    id INT IDENTITY(1,1) PRIMARY KEY,
    study_id NVARCHAR(50) NOT NULL,
    file_path NVARCHAR(500) NOT NULL,
    file_name NVARCHAR(255) NOT NULL,
    instance_number INT,
    uploaded_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (study_id) REFERENCES studies(study_id)
);
GO

-- Nodules tablosu
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='nodules' AND xtype='U')
CREATE TABLE nodules (
    id INT IDENTITY(1,1) PRIMARY KEY,
    study_id NVARCHAR(50) NOT NULL,
    nodule_number INT,
    location NVARCHAR(100),
    size_mm FLOAT,
    risk_level NVARCHAR(20),
    coordinates NVARCHAR(MAX),
    created_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (study_id) REFERENCES studies(study_id)
);
GO

PRINT 'Tüm tablolar başarıyla oluşturuldu!';
