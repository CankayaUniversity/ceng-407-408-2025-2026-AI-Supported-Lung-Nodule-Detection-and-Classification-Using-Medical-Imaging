import axios from 'axios';

const API_BASE_URL = 'http://localhost:3001/api';

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Patient API
export const patientAPI = {
  create: (patientData) => api.post('/patients', patientData),
  getAll: () => api.get('/patients'),
  getById: (patientId) => api.get(`/patients/${patientId}`),
};

// Study API
export const studyAPI = {
  create: (studyData) => api.post('/studies', studyData),
  getAll: () => api.get('/studies'),
  getById: (studyId) => api.get(`/studies/${studyId}`),
  updateStatus: (studyId, status, noduleCount) => 
    api.put(`/studies/${studyId}/status`, { status, noduleCount }),
  getDicomFiles: (studyId) => api.get(`/studies/${studyId}/dicom-files`),
  getNodules: (studyId) => api.get(`/studies/${studyId}/nodules`),
};

// DICOM upload API
export const dicomAPI = {
  uploadFiles: async (studyId, files) => {
    const formData = new FormData();
    formData.append('study_id', studyId);
    
    for (let i = 0; i < files.length; i++) {
      formData.append('dicomFiles', files[i]);
    }
    
    return api.post('/upload-dicom', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        console.log(`Upload progress: ${percentCompleted}%`);
      },
    });
  },
};

// Nodule API
export const noduleAPI = {
  create: (noduleData) => api.post('/nodules', noduleData),
  getById: (id) => api.get(`/nodules/${id}`),
  getByStudy: (studyId) => api.get(`/studies/${studyId}/nodules`),
  update: (id, noduleData) => api.put(`/nodules/${id}`, noduleData),
};

// Report API
export const reportAPI = {
  create: (reportData) => api.post('/reports', reportData),
  getAll: () => api.get('/reports'),
  getById: (id) => api.get(`/reports/${id}`),
  getByUser: (userId) => api.get(`/reports?user_id=${userId}`),
  delete: (id) => api.delete(`/reports/${id}`),
};

// User API
export const userAPI = {
  create: (userData) => api.post('/users', userData),
  getAll: () => api.get('/users'),
  getById: (id) => api.get(`/users/${id}`),
  updateStatus: (id, status) => api.put(`/users/${id}/status`, { status }),
  updateProfile: (id, profileData) => api.put(`/users/${id}/profile`, profileData),
  delete: (id) => api.delete(`/users/${id}`),
};

// Auth API
export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
};

// Dashboard API
export const dashboardAPI = {
  getStats: () => api.get('/stats/dashboard'),
  getUserStats: () => api.get('/stats/users'),
};

// Activity Log API
export const activityLogAPI = {
  create: (logData) => api.post('/activity-logs', logData),
  getAll: (limit = 50) => api.get(`/activity-logs?limit=${limit}`),
  getRecent: (hours = 24) => api.get(`/activity-logs/recent?hours=${hours}`),
};

export default api;
