const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();

// CORS configuration
app.use(cors({
  origin: 'http://localhost:5173', // Your frontend URL
  credentials: true
}));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

let dbConnected = false; // Track DB status

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/finddoctor', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', (err) => {
  console.error('MongoDB connection error:', err);
  dbConnected = false;
});
db.once('open', () => {
  console.log('Connected to MongoDB');
  dbConnected = true;
});

// Routes
app.get('/', (req, res) => {
  const statusCircle = dbConnected ? '🟢' : '🔴';
  res.send(`
    <html>
      <head><title>Server Status</title></head>
      <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
        <h1>FindDoctor Server</h1>
        <p>Status: ${statusCircle} ${dbConnected ? 'Connected to MongoDB' : 'Not connected to MongoDB'}</p>
        <p>Authentication: Enabled</p>
        <p>Image uploads: Enabled</p>
        <p>Static files served from: /uploads</p>
      </body>
    </html>
  `);
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/doctors', require('./routes/doctors'));
app.use('/api/blogs', require('./routes/blogs'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/blogs', require('./routes/blogs'));

// Error handling middleware
app.use((error, req, res, next) => {
  // Handle Multer errors (file upload errors)
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: 'File too large. Maximum size is 5MB.' });
  }
  
  // Handle validation errors
  if (error.name === 'ValidationError') {
    return res.status(400).json({ message: error.message });
  }
  
  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({ message: 'Invalid token' });
  }
  
  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Token expired' });
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ message: 'Internal server error' });
});

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Auth routes available at: http://localhost:${PORT}/api/auth`);
  console.log(`Static files served from: ${path.join(__dirname, 'uploads')}`);
});