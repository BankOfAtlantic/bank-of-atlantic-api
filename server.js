// server.js for Render.com
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const brevo = require('@getbrevo/brevo');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== BREVO API SETUP ==========
// Initialize the API client
const defaultClient = brevo.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY; // Your existing key in Render

const apiInstance = new brevo.TransactionalEmailsApi();

// Function to send email via Brevo API
async function sendEmail(to, subject, htmlContent) {
  try {
    const sendSmtpEmail = new brevo.SendSmtpEmail({
      sender: {
        email: "contact@bankofatlantic.co.uk",
        name: "Bank of Atlantic Support"
      },
      to: [{ email: to }],
      subject: subject,
      htmlContent: htmlContent
    });

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('✅ Email sent successfully via Brevo API to:', to);
    return { success: true, messageId: data.messageId };
    
  } catch (error) {
    console.error('❌ Brevo API error:', error.message);
    if (error.response) {
      console.error('Brevo API response:', error.response.body);
    }
    return { success: false, error: error.message };
  }
}

// ========== APP SETUP ==========

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

// FORGOT PASSWORD - Check email and send reset
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    console.log('🔑 Forgot password request for:', email);
    
    const db = mongoose.connection.db;
    
    // Check if user exists
    const user = await db.collection('users').findOne({ email });
    
    if (user) {
      // Generate reset token (simple version)
      const resetToken = Math.random().toString(36).substring(2) + 
                        Date.now().toString(36);
      
      // Save token to user in database (with 1-hour expiry)
      await db.collection('users').updateOne(
        { email: email },
        { 
          $set: { 
            resetToken: resetToken,
            resetTokenExpiry: Date.now() + 3600000 // 1 hour
          }
        }
      );
      
      // Create reset link
      const resetLink = `https://bankofatlantic.co.uk/reset-password.html?token=${resetToken}`;
      
      // Email content
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(to right, #01579b, #0288d1); padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">Bank of Atlantic</h1>
            <p style="color: #c5e3fc; margin: 5px 0 0 0;">Secure Online Banking</p>
          </div>
          
          <div style="padding: 30px; background: #f8f9fa;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>Hello ${user.firstName},</p>
            <p>We received a request to reset your password for your Bank of Atlantic account.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" 
                 style="background: linear-gradient(to right, #c9a965, #b8964c); 
                        color: white; 
                        padding: 15px 30px; 
                        text-decoration: none; 
                        border-radius: 8px; 
                        font-weight: bold;
                        display: inline-block;">
                Reset Your Password
              </a>
            </div>
            
            <p>Or copy this link:</p>
            <p style="background: #e9ecef; padding: 10px; border-radius: 5px; word-break: break-all;">
              ${resetLink}
            </p>
            
            <p>This link will expire in 1 hour for security reasons.</p>
            
            <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; color: #856404;">
                <strong>Security Notice:</strong> If you didn't request this password reset, please ignore this email or contact our support team immediately.
              </p>
            </div>
            
            <p>Best regards,<br>Bank of Atlantic Security Team</p>
          </div>
          
          <div style="background: #343a40; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px;">
            <p style="margin: 0; font-size: 12px;">
              © 2024 Bank of Atlantic Limited. All rights reserved.<br>
              This is an automated message, please do not reply.
            </p>
          </div>
        </div>
      `;
      
      // Send email via Brevo API
      const emailResult = await sendEmail(email, 'Password Reset Request - Bank of Atlantic', emailHtml);
      
      if (emailResult.success) {
        console.log('✅ Password reset email sent via Brevo API to:', email);
      } else {
        console.log('⚠️ Email sending had issue:', emailResult.error);
      }
    }
    
    // Always return success (security best practice)
    res.json({
      success: true,
      message: 'If an account exists with this email, password reset instructions have been sent.'
    });
    
  } catch (error) {
    console.error('❌ Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error processing request'
    });
  }
});

// RESET PASSWORD with token
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    console.log('🔑 Reset password request with token');
    
    const db = mongoose.connection.db;
    
    // Find user with valid token
    const user = await db.collection('users').findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() } // Token not expired
    });
    
    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired reset token'
      });
    }
    
    // Update password and clear token
    await db.collection('users').updateOne(
      { email: user.email },
      { 
        $set: { 
          password: newPassword 
        },
        $unset: {
          resetToken: "",
          resetTokenExpiry: ""
        }
      }
    );
    
    console.log('✅ Password updated for:', user.email);
    
    res.json({
      success: true,
      message: 'Password has been successfully reset'
    });
    
  } catch (error) {
    console.error('❌ Reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error processing request'
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