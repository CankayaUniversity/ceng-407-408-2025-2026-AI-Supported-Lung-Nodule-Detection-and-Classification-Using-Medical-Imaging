# Lung Nodule Detection System – Local Setup Guide (Windows)

This document explains **all required dependencies and setup steps** needed to successfully run the project using `start.bat`.
It is written for **external users** who clone the repository for the first time.

---

## 1. System Requirements (Mandatory)

Before running the project, **all items below must be installed**.

### 1.1 Node.js
- Install **Node.js LTS** (recommended)
- Download: https://nodejs.org
- Verify after install:
```bash
node -v
npm -v
```

### 1.2 Microsoft SQL Server Express
- Install **SQL Server Express (Database Engine)**
- Instance name **must be**:
```
SQLEXPRESS
```
- During setup:
  - Authentication: **Windows Authentication**
  - Keep default settings

### 1.3 SQL Server Management Studio (SSMS)
(Required to inspect users and database)
- Download: https://learn.microsoft.com/en-us/sql/ssms
- Used for:
  - Viewing database tables
  - Checking default login credentials

---

## 2. Project Structure

```
root/
│── backend/        # Express.js backend (API)
│── UI/             # Vite frontend
│── start.bat       # Starts backend + frontend
│── README.md
```

### Ports
| Service   | URL |
|----------|-----|
| Backend  | http://localhost:3001 |
| Frontend | http://localhost:5173 |

---

## 3. First-Time Dependency Installation (REQUIRED)

⚠️ `start.bat` **will NOT work** unless these steps are completed first.

### 3.1 Backend Dependencies
```bash
cd backend
npm install
```

### 3.2 Frontend Dependencies
```bash
cd UI
npm install
```

---

## 4. Backend Environment Configuration (.env)

The backend requires a `.env` file.

### 4.1 Create `.env`
```bash
cd backend
copy .env.example .env
```

### 4.2 Edit `.env`
Open the file and ensure the following values:

```env
DB_SERVER=.\SQLEXPRESS
DB_DATABASE=lung_nodule
PORT=3001
```

---

## 5. Running the System

After all steps above are completed:

```bash
cd <project-root>
start.bat
```

Expected output:
- Backend starts on **localhost:3001**
- Frontend starts on **localhost:5173**
- No dependency errors

⚠️ Closing the `start.bat` window will stop the system.

---

## 6. Verifying Backend Health

Open in browser:
```
http://localhost:3001/api/health
```

Expected response:
```json
{
  "status": "ok",
  "message": "Server is running"
}
```

---

## 7. Default Login Credentials

The system auto-creates default users on first run.

### Admin Account
```
Username: admin
Password: admin123
```

### Doctor Account
```
Username: doctor
Password: doctor123
```

Login via frontend:
```
http://localhost:5173
```

---

## 8. SQL Server (SSMS) Connection Notes

When connecting via SSMS:

### Server Name
```
.\SQLEXPRESS
```

### Authentication
```
Windows Authentication
```

### SSL Error Fix
If you see:
> Certificate chain was issued by an untrusted authority

Then:
- Check **Trust server certificate**
- (Optional) Set Encryption to **Optional**

---

## 9. Common Errors & Fixes

### ❌ start.bat closes immediately
**Cause:** Dependencies not installed  
**Fix:** Run `npm install` in `backend/` and `UI/`

### ❌ Cannot find package 'express'
```bash
cd backend
npm install
```

### ❌ 'vite' is not recognized
```bash
cd UI
npm install
npm run dev
```

### ❌ DB_SERVER is not defined
- `.env` file missing or incorrect
- Recheck `.env` configuration

---

## 10. Security Note (Academic Prototype)

- Passwords are stored in **plain text**
- No JWT / session management
- Intended for **academic demonstration only**

---

## 11. Summary (Minimum Steps)

```bash
npm install (backend)
npm install (UI)
copy .env.example .env
edit .env (DB_SERVER)
start.bat
```

System will be available at:
- http://localhost:5173
