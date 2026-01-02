import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from 'lucide-react';
import './Login.css';
import logo from '../assets/logo.png';

const API_URL = 'http://localhost:3001/api';

function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    
    if (!username.trim() || !password.trim()) {
      setError('Please enter username and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const result = await response.json();

      if (result.success) {
        // Save user information
        localStorage.setItem('userType', result.user.role.toLowerCase());
        localStorage.setItem('username', result.user.name);
        localStorage.setItem('userId', result.user.id.toString());
        localStorage.setItem('userEmail', result.user.email);
        localStorage.setItem('userFirstName', result.user.firstName);
        localStorage.setItem('userLastName', result.user.lastName);
        localStorage.setItem('userSpecialization', result.user.specialization || '');
        localStorage.setItem('userDepartment', result.user.department || '');
        localStorage.setItem('userHospital', result.user.hospital || '');
        localStorage.setItem('userLicenseNumber', result.user.licenseNumber || '');

        // Redirect based on role
        if (result.user.role === 'Admin') {
          navigate('/admin');
        } else {
          navigate('/worklist');
        }
      } else {
        setError(result.error || 'Login failed');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('Cannot connect to server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-left">
        <div className="login-left-content">
          <img src={logo} alt="LungXAI" className="login-logo" />
          <h2 className="login-tagline">
            AI-Powered <span>Lung Nodule</span> Detection
          </h2>
          <p className="login-description">
            Advanced deep learning system for detecting and classifying lung nodules 
            in CT scans with explainable AI insights for clinical decision support.
          </p>
          <div className="login-features">
            <div className="feature-item">
              <div className="feature-icon">✓</div>
              <span>AI-powered nodule detection with high accuracy</span>
            </div>
            <div className="feature-item">
              <div className="feature-icon">✓</div>
              <span>Explainable AI for transparent clinical insights</span>
            </div>
            <div className="feature-item">
              <div className="feature-icon">✓</div>
              <span>Comprehensive reporting and risk assessment</span>
            </div>
          </div>
        </div>
      </div>

      {}
      <div className="login-right">
        <div className="login-form-container">
          <img src={logo} alt="LungXAI" className="mobile-logo" />
          <div className="login-header">
            <h1>Welcome</h1>
            <p>Sign in to continue to LungXAI</p>
          </div>

          <form className="login-form" onSubmit={handleLogin}>
            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="form-input"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-input"
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="login-btn"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader size={20} className="spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="login-footer">
            <p>Medical Imaging Analysis System</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
