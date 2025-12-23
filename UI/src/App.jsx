import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import FullScreenLayout from './components/FullScreenLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import WorkList from './pages/WorkList';
import CaseViewer from './pages/CaseViewer';
import NewStudy from './pages/NewStudy';
import PastStudies from './pages/PastStudies';
import MyReports from './pages/MyReports';
import Review from './pages/Review';
import Profile from './pages/Profile';
import AdminDashboard from './pages/AdminDashboard';
import UserManagement from './pages/UserManagement';
import SystemSettings from './pages/SystemSettings';
import ActivityLogs from './pages/ActivityLogs';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/users" element={<UserManagement />} />
        <Route path="/admin/settings" element={<SystemSettings />} />
        <Route path="/admin/logs" element={<ActivityLogs />} />
        <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
        <Route path="/worklist" element={<Layout><WorkList /></Layout>} />
        <Route path="/new-study" element={<Layout><NewStudy /></Layout>} />
        <Route path="/past-studies" element={<Layout><PastStudies /></Layout>} />
        <Route path="/my-reports" element={<Layout><MyReports /></Layout>} />
        <Route path="/profile" element={<Layout><Profile /></Layout>} />
        <Route path="/review/:studyId" element={<FullScreenLayout><Review /></FullScreenLayout>} />
        <Route path="/case/:studyId" element={<Layout><CaseViewer /></Layout>} />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
