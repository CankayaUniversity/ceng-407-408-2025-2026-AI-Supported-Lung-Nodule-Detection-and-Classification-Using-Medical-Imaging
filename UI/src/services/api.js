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
  getByStudy: (studyId) => api.get(`/studies/${studyId}/nodules`),
};

export default api;
