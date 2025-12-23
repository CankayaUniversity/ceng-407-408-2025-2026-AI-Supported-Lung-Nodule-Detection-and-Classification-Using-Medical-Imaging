import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import './Login.css';

function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [userType, setUserType] = useState(null);

  const handleLogin = (type) => {
    if (username.trim() && password.trim()) {
      // Store user type for later use
      localStorage.setItem('userType', type);
      localStorage.setItem('username', username);
      
      if (type === 'doctor') {
        navigate('/worklist');
      } else if (type === 'admin') {
        navigate('/admin');
      }
    } else {
      alert('Please enter username and password');
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

        <form className="login-form" onSubmit={(e) => e.preventDefault()}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="form-input"
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
            />
          </div>

          <div className="role-selection">
            <p className="role-label">Select Your Role:</p>
            <div className="role-buttons">
              <button
                type="button"
                className={`role-btn doctor-btn ${userType === 'doctor' ? 'active' : ''}`}
                onClick={() => setUserType('doctor')}
              >
                <span className="role-name">Doctor</span>
                <span className="role-desc">Medical Professional</span>
              </button>
              <button
                type="button"
                className={`role-btn admin-btn ${userType === 'admin' ? 'active' : ''}`}
                onClick={() => setUserType('admin')}
              >
                <span className="role-name">Administrator</span>
                <span className="role-desc">System Admin</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            className="login-btn"
            onClick={() => userType && handleLogin(userType)}
            disabled={!userType}
          >
            Sign In
          </button>
        </form>

        <div className="login-footer">
          <p>Demo Credentials</p>
          <p className="demo-text">Username: demo | Password: demo123</p>
        </div>
      </div>
    </div>
  );
}

export default Login;
