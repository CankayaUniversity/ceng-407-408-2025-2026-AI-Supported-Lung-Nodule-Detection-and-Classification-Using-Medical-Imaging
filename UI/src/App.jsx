import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import FullScreenLayout from './components/FullScreenLayout';
import Dashboard from './pages/Dashboard';
import WorkList from './pages/WorkList';
import CaseViewer from './pages/CaseViewer';
import NewStudy from './pages/NewStudy';
import PastStudies from './pages/PastStudies';
import MyReports from './pages/MyReports';
import Review from './pages/Review';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
        <Route path="/worklist" element={<Layout><WorkList /></Layout>} />
        <Route path="/new-study" element={<Layout><NewStudy /></Layout>} />
        <Route path="/past-studies" element={<Layout><PastStudies /></Layout>} />
        <Route path="/my-reports" element={<Layout><MyReports /></Layout>} />
        <Route path="/review/:studyId" element={<FullScreenLayout><Review /></FullScreenLayout>} />
        <Route path="/case/:studyId" element={<Layout><CaseViewer /></Layout>} />
        <Route path="/" element={<Navigate to="/worklist" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
