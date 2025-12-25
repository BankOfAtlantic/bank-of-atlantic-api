// =====================
// server.js (PRODUCTION READY)
// =====================

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const brevo = require('@getbrevo/brevo');

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
// BREVO SETUP
// =====================
const defaultClient = brevo.ApiClient.instance;
defaultClient.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;
const emailApi = new brevo.TransactionalEmailsApi();

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

async function sendEmail(to, subject, html) {
  const emailData = new brevo.SendSmtpEmail({
    sender: {
      email: 'contact@bankofatlantic.co.uk',
      name: 'Bank of Atlantic'
    },
    to: [{ email: to }],
    subject,
    htmlContent: html
  });

  await emailApi.sendTransacEmail(emailData);
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
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
