const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

let dbConnected = false; // 👈 track DB status

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
      </body>
    </html>
  `);
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/doctors', require('./routes/doctors'));
app.use('/api/blogs', require('./routes/blogs'));
app.use('/api/contact', require('./routes/contact'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
