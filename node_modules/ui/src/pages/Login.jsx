import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Loader } from 'lucide-react';
import './Login.css';

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
      <div className="login-card">
        <div className="login-header">
          <div className="logo-icon">
            <LogIn size={40} />
          </div>
          <h1>LungXAI</h1>
          <p>Medical Imaging Analysis System</p>
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
                <Loader size={18} className="spin" />
                Logging in...
              </>
            ) : (
              'Login'
            )}
          </button>
        </form>

        <div className="login-footer">
          <p>Use the credentials provided by</p>
          <p className="demo-text">your system administrator</p>
        </div>
      </div>
    </div>
  );
}

export default Login;
