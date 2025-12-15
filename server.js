// server.js for Render.com
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS - Allow your Netlify domain
app.use(cors({
  origin: [
    'https://bankofatlantic.co.uk',
    'https://www.bankofatlantic.co.uk',
    'https://bankofatlantic.netlify.app',  // Your actual Netlify URL
    'http://localhost:3000',
    'http://localhost:5500'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// MongoDB Connection
console.log('🔗 Connecting to MongoDB Atlas...');

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ Connected to MongoDB Atlas!');
})
.catch(err => {
  console.error('❌ MongoDB connection failed:', err.message);
});

// ========== API ENDPOINTS ==========

// Health check
app.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Bank of Atlantic API is running',
    time: new Date().toISOString()
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Backend API is working!',
    time: new Date().toISOString()
  });
});

// Database test
app.get('/api/test-db', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const users = await db.collection('users').find({}).toArray();
    
    res.json({
      success: true,
      message: 'Database connected!',
      collections: collections.map(c => c.name),
      totalUsers: users.length,
      users: users.map(u => ({
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown',
        email: u.email || 'No email',
        type: u.accountType || 'Unknown'
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// REGISTRATION - Save to MongoDB
app.post('/api/auth/register', async (req, res) => {
  try {
    console.log('📝 Registration attempt:', req.body.email);
    
    const db = mongoose.connection.db;
    
    // Check if user exists
    const existingUser = await db.collection('users').findOne({ 
      email: req.body.email 
    });
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered'
      });
    }
    
    // Create new user
    const newUser = {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      password: req.body.password,
      phone: req.body.phone || '',
      address: req.body.address || '',
      country: req.body.country || '',
      zip: req.body.zip || '',
      accountType: req.body.accountType,
      accountActivated: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Save to MongoDB
    const result = await db.collection('users').insertOne(newUser);
    
    console.log('✅ User saved to MongoDB:', newUser.email);
    
    // Return success with user data
    res.json({
      success: true,
      message: 'Account created successfully!',
      user: {
        _id: result.insertedId,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        accountType: newUser.accountType,
        accountActivated: false
      }
    });
    
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during registration'
    });
  }
});

// LOGIN - Get from MongoDB
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('🔐 Login attempt:', email);
    
    const db = mongoose.connection.db;
    
    // Find user in MongoDB
    const user = await db.collection('users').findOne({ email });
    
    if (!user) {
      console.log('❌ User not found:', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }
    
    // Check password
    if (user.password !== password) {
      console.log('❌ Wrong password for:', email);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }
    
    console.log('✅ Login successful for:', user.email);
    
    // Return ACTUAL user data from MongoDB
    res.json({
      success: true,
      message: 'Login successful!',
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        accountType: user.accountType || 'domiciliary',
        accountActivated: user.accountActivated || false
      },
      token: 'jwt-token-placeholder'
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during login'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Bank of Atlantic API running on port ${PORT}`);
});