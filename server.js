// =====================
// server.js (PRODUCTION READY)
// =====================

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

// =====================
// BASIC SAFETY CHECKS
// =====================
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI missing');
  process.exit(1);
}
if (!process.env.BREVO_API_KEY) {
  console.error('❌ BREVO_API_KEY missing');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET missing');
  process.exit(1);
}

// =====================
// BREVO EMAIL FUNCTION
// =====================
async function sendEmail(to, subject, html) {
  console.log('🔍 EMAIL DEBUG: Starting to send email to', to);
  
  try {
    const emailData = {
      sender: {
        name: 'Bank of Atlantic',
        email: 'contact@bankofatlantic.co.uk'
      },
      to: [{ email: to }],
      subject: subject,
      htmlContent: html
    };

    console.log('📤 Sending to Brevo API:', JSON.stringify(emailData, null, 2));
    
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify(emailData)
    });

    console.log('📨 Brevo API Response Status:', response.status);
    console.log('📨 Brevo API Response Headers:', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log('📨 Brevo API Response Body:', responseText);
    
    if (!response.ok) {
      throw new Error(`Brevo API error ${response.status}: ${responseText}`);
    }

    const result = JSON.parse(responseText);
    console.log('✅ Email sent successfully:', result.messageId);
    return result;
    
  } catch (error) {
    console.error('❌ EMAIL SEND FAILED:', error.message);
    console.error('❌ Full error:', error);
    throw error;
  }
}
// =====================
// EXPRESS SETUP
// =====================
app.use(express.json());

app.use(cors({
  origin: [
    'https://bankofatlantic.co.uk',
    'https://www.bankofatlantic.co.uk',
    'https://bankofatlantic.netlify.app',
    'http://localhost:3000',
    'http://localhost:5500'
  ],
  credentials: true
}));

// =====================
// DATABASE
// =====================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB error:', err.message);
    process.exit(1);
  });

// =====================
// UTILITIES
// =====================
function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// =====================
// AUTH MIDDLEWARE
// =====================
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });

  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// =====================
// HEALTH
// =====================
app.get('/', (req, res) => {
  res.json({ success: true, message: 'API running' });
});

// =====================
// REGISTER
// =====================
app.post('/api/auth/register', async (req, res) => {
  const db = mongoose.connection.db;
  const { firstName, lastName, email, password, accountType } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const existing = await db.collection('users').findOne({ email });
  if (existing) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const verificationToken = generateToken();

  await db.collection('users').insertOne({
    firstName,
    lastName,
    email,
    password: hashedPassword,
    accountType,
    accountActivated: false,
    verificationToken,
    verificationExpiry: Date.now() + 24 * 60 * 60 * 1000,
    createdAt: new Date()
  });

  const link = `${process.env.FRONTEND_URL}/verify.html?token=${verificationToken}`;

  await sendEmail(
    email,
    'Verify your Bank of Atlantic account',
    `<p>Hello ${firstName},</p>
     <p>Please verify your account:</p>
     <a href="${link}">Verify Account</a>`
  );

  res.json({ success: true, message: 'Verification email sent' });
});

// =====================
// VERIFY EMAIL
// =====================
app.post('/api/auth/verify', async (req, res) => {
  const db = mongoose.connection.db;
  const { token } = req.body;

  const user = await db.collection('users').findOne({
    verificationToken: token,
    verificationExpiry: { $gt: Date.now() }
  });

  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }

  await db.collection('users').updateOne(
    { email: user.email },
    {
      $set: { accountActivated: true },
      $unset: { verificationToken: '', verificationExpiry: '' }
    }
  );

  res.json({ success: true });
});

// =====================
// LOGIN
// =====================
app.post('/api/auth/login', async (req, res) => {
  const db = mongoose.connection.db;
  const { email, password } = req.body;

  const user = await db.collection('users').findOne({ email });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  if (!user.accountActivated) {
    return res.status(403).json({ error: 'Account not verified' });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  res.json({ success: true, token });
});

// =====================
// FORGOT PASSWORD
// =====================
app.post('/api/auth/forgot-password', async (req, res) => {
  const db = mongoose.connection.db;
  const { email } = req.body;

  const user = await db.collection('users').findOne({ email });
  if (user) {
    const resetToken = generateToken();

    await db.collection('users').updateOne(
      { email },
      {
        $set: {
          resetToken,
          resetExpiry: Date.now() + 3600000
        }
      }
    );

    const link = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;

    await sendEmail(
      email,
      'Password reset',
      `<p>Reset your password:</p><a href="${link}">Reset Password</a>`
    );
  }

  res.json({ success: true });
});

// =====================
// RESET PASSWORD
// =====================
app.post('/api/auth/reset-password', async (req, res) => {
  const db = mongoose.connection.db;
  const { token, newPassword } = req.body;

  const user = await db.collection('users').findOne({
    resetToken: token,
    resetExpiry: { $gt: Date.now() }
  });

  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }

  const hashed = await bcrypt.hash(newPassword, 12);

  await db.collection('users').updateOne(
    { email: user.email },
    {
      $set: { password: hashed },
      $unset: { resetToken: '', resetExpiry: '' }
    }
  );

  res.json({ success: true });
});

// =====================
// PROTECTED TEST ROUTE
// =====================
app.get('/api/me', auth, (req, res) => {
  res.json({ success: true, user: req.user });
});

// =====================
// DEBUG ENDPOINT
// =====================
app.get('/api/debug/config', (req, res) => {
  // Don't show full API key for security
  const apiKeyPreview = process.env.BREVO_API_KEY ? 
    `****${process.env.BREVO_API_KEY.substring(process.env.BREVO_API_KEY.length - 8)}` : 
    'NOT SET';
  
  res.json({
    environment: {
      BREVO_API_KEY_SET: !!process.env.BREVO_API_KEY,
      BREVO_API_KEY_PREVIEW: apiKeyPreview,
      BREVO_API_KEY_LENGTH: process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.length : 0,
      MONGODB_URI_SET: !!process.env.MONGODB_URI,
      JWT_SECRET_SET: !!process.env.JWT_SECRET,
      FRONTEND_URL: process.env.FRONTEND_URL || 'NOT SET',
      NODE_ENV: process.env.NODE_ENV || 'development',
      PORT: process.env.PORT || 3000
    },
    serverInfo: {
      brevoEndpoint: 'https://api.brevo.com/v3/smtp/email',
      senderEmail: 'contact@bankofatlantic.co.uk',
      senderName: 'Bank of Atlantic',
      nodeVersion: process.version
    },
    timestamp: new Date().toISOString(),
    note: 'API key is masked for security'
  });
});

// =====================
// START SERVER
// =====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Bank of Atlantic API running on port ${PORT}`);
});
