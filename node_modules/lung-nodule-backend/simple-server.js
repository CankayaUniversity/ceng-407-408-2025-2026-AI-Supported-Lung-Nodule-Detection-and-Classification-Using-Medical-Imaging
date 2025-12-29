const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  console.log('Health check received');
  res.json({ status: 'ok', message: 'Server is running' });
});

app.post('/api/patients', (req, res) => {
  console.log('Patient data received:', req.body);
  res.json({ success: true, id: Date.now() });
});

app.post('/api/studies', (req, res) => {
  console.log('Study data received:', req.body);
  res.json({ success: true, id: Date.now() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Simple server running on http://localhost:${PORT}`);
});
