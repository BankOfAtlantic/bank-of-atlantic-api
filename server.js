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
// BREVO EMAIL FUNCTION (WITH DEBUG LOGGING)
// =====================
async function sendEmail(to, subject, html) {
  console.log('📧 DEBUG: Starting sendEmail function');
  console.log('📧 To:', to);
  console.log('📧 Subject:', subject);
  
  // Trim API key just in case
  const apiKey = process.env.BREVO_API_KEY.trim();
  console.log('🔑 API Key (first/last 8 chars):', 
    apiKey.substring(0, 8) + '...' + apiKey.substring(apiKey.length - 8));
  
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

    console.log('📤 Sending to Brevo API...');
    
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(emailData)
    });

    console.log('📨 Brevo Response Status:', response.status);
    console.log('📨 Brevo Response Status Text:', response.statusText);
    
    const responseText = await response.text();
    console.log('📨 Brevo Response Body:', responseText);
    
    if (!response.ok) {
      console.error('❌ Brevo API Error:', responseText);
      throw new Error(`Brevo API error ${response.status}: ${responseText}`);
    }

    console.log('✅ Email sent successfully!');
    return JSON.parse(responseText);
    
  } catch (error) {
    console.error('❌ Email sending failed completely:', error.message);
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

  console.log('📝 Registration attempt:', email);
  
  if (!email || !password) {
    console.log('❌ Missing fields');
    return res.status(400).json({ error: 'Missing fields' });
  }

  const existing = await db.collection('users').findOne({ email });
  if (existing) {
    console.log('❌ Email already exists:', email);
    return res.status(400).json({ error: 'Email already registered' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const verificationToken = generateToken();
  
  console.log('✅ Generated token:', verificationToken.substring(0, 20) + '...');
  console.log('✅ Expiry:', new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());

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

  console.log('✅ User saved to database');
  
  const link = `${process.env.FRONTEND_URL}/verify.html?token=${verificationToken}`;
  
  console.log('📧 Sending verification email...');
  console.log('📧 Link:', link);

  try {
    await sendEmail(
      email,
      'Verify your Bank of Atlantic account',
      `<p>Hello ${firstName},</p>
       <p>Please verify your account:</p>
       <a href="${link}">Verify Account</a>
       <p>This link expires in 24 hours.</p>`
    );
    
    console.log('✅ Email sent successfully to:', email);
    res.json({ 
  success: true, 
  message: 'Verification email sent',
  user: {
    firstName: firstName,
    lastName: lastName,
    email: email,
    accountType: accountType,
    accountActivated: false
  }
});
    
  } catch (error) {
    console.error('❌ Email failed to send:', error.message);
    
    // Delete the user since email failed
    await db.collection('users').deleteOne({ email });
    
    res.status(500).json({ 
      error: 'Failed to send verification email. Please try again.' 
    });
  }
});

// =====================
// VERIFY EMAIL
// =====================
app.post('/api/auth/verify', async (req, res) => {
  const db = mongoose.connection.db;
  const { token } = req.body;
  
  console.log('🔐 Verification attempt with token:', token);
  
  if (!token) {
    console.log('❌ No token provided');
    return res.status(400).json({ error: 'No token provided' });
  }

  try {
    // FIRST: Find user with token
    const user = await db.collection('users').findOne({
      verificationToken: token
    });

    console.log('🔍 User found:', user ? user.email : 'NO USER FOUND');
    
    if (!user) {
      console.log('❌ No user found with this token');
      return res.status(400).json({ error: 'Invalid verification link' });
    }

    // SECOND: Check if token expired
    const now = Date.now();
    console.log('⏰ Token expiry check:');
    console.log('   - Token expiry:', new Date(user.verificationExpiry).toISOString());
    console.log('   - Current time:', new Date(now).toISOString());
    console.log('   - Is expired?', user.verificationExpiry < now);
    
    if (user.verificationExpiry < now) {
      console.log('❌ Token expired');
      return res.status(400).json({ error: 'Verification link has expired' });
    }

    // THIRD: Check if already activated
    if (user.accountActivated) {
      console.log('⚠️ Account already activated');
      return res.status(400).json({ error: 'Account already verified' });
    }

    // FOURTH: Activate account
    console.log('✅ Activating account for:', user.email);
    
    await db.collection('users').updateOne(
      { email: user.email },
      {
        $set: { accountActivated: true },
        $unset: { verificationToken: '', verificationExpiry: '' }
      }
    );

    console.log('✅ Account activated successfully');
    res.json({ success: true, message: 'Account verified successfully' });

  } catch (error) {
    console.error('❌ Verification error:', error);
    res.status(500).json({ error: 'Server error during verification' });
  }
});

// =====================
// LOGIN
// =====================
app.post('/api/auth/login', async (req, res) => {
  const db = mongoose.connection.db;
  const { email, password } = req.body;

  console.log('🔐 Login attempt for:', email);

  try {
    // Find user by email
    const user = await db.collection('users').findOne({ email });
    
    if (!user) {
      console.log('❌ User not found:', email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log('✅ User found:', user.email);
    console.log('   - Account activated:', user.accountActivated);
    console.log('   - User data:', {
      firstName: user.firstName,
      lastName: user.lastName,
      accountType: user.accountType
    });

    // Check if account is activated
    if (!user.accountActivated) {
      console.log('❌ Account not activated:', email);
      return res.status(403).json({ 
        error: 'Account not verified. Please check your email for verification link.' 
      });
    }

    // Verify password
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.log('❌ Password mismatch for:', email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create JWT token
    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('✅ Login successful for:', email);
    console.log('   - Token generated');

    // Return complete response with user data
    res.json({ 
      success: true, 
      token: token,
      user: {
        _id: user._id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        accountType: user.accountType,
        accountActivated: user.accountActivated,
        createdAt: user.createdAt
      },
      message: 'Login successful'
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
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
// REAL PRODUCTION DIAGNOSIS
// =====================
app.get('/api/diagnose/verify/:token', async (req, res) => {
  const db = mongoose.connection.db;
  const token = req.params.token;
  
  console.log('🔧 Production diagnosis for token:', token);
  
  try {
    // 1. Find the user
    const user = await db.collection('users').findOne({
      verificationToken: token
    });

    if (!user) {
      return res.json({
        status: 'ERROR',
        issue: 'TOKEN_NOT_FOUND',
        message: 'No user found with this verification token',
        suggestion: 'The token in the URL does not match any user in our database'
      });
    }

    // 2. Check token expiry
    const now = Date.now();
    const expiryDate = new Date(user.verificationExpiry);
    const isExpired = user.verificationExpiry < now;
    
    if (isExpired) {
      return res.json({
        status: 'ERROR',
        issue: 'TOKEN_EXPIRED',
        message: 'Verification token has expired',
        details: {
          tokenCreated: new Date(user.createdAt).toISOString(),
          tokenExpired: expiryDate.toISOString(),
          currentTime: new Date(now).toISOString(),
          hoursSinceExpiry: Math.round((now - user.verificationExpiry) / 1000 / 60 / 60 * 10) / 10
        },
        suggestion: 'Request a new verification email from the login page'
      });
    }

    // 3. Check if already activated
    if (user.accountActivated) {
      return res.json({
        status: 'SUCCESS',
        issue: 'ALREADY_ACTIVATED',
        message: 'Account is already verified',
        details: {
          email: user.email,
          activated: true
        },
        suggestion: 'You can log in directly without verification'
      });
    }

    // 4. Token is valid
    return res.json({
      status: 'READY',
      issue: 'VALID_TOKEN',
      message: 'Token is valid and ready for verification',
      details: {
        email: user.email,
        firstName: user.firstName,
        tokenValid: true,
        expiresIn: Math.round((user.verificationExpiry - now) / 1000 / 60 / 60 * 10) / 10 + ' hours'
      },
      suggestion: 'Click the verify button to complete the process'
    });

  } catch (error) {
    console.error('Diagnosis error:', error);
    res.status(500).json({
      status: 'ERROR',
      issue: 'SERVER_ERROR',
      message: 'Internal server error',
      error: error.message
    });
  }
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
