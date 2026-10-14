require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const {
  connectToWhatsApp,
  getSocket,
  requestPairingCode,
  getStatus,
  resetSession
} = require('./src/whatsapp');
const { initScheduler } = require('./src/scheduler');
const { User } = require('./src/database');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================================
// PAIRING ROUTES
// ============================================================

// Get bot connection status
app.get('/api/status', (req, res) => {
  res.json(getStatus());
});

// Request a pairing code
app.post('/api/pair', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const result = await requestPairingCode(phoneNumber);
    res.json({
      success: true,
      code: result.code,
      number: result.number,
      instructions: 'Open WhatsApp → Settings → Linked Devices → Link with phone number → Enter this code'
    });
  } catch (error) {
    console.error('Pair error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Reset session (clear auth + reconnect)
app.post('/api/reset', async (req, res) => {
  try {
    const success = await resetSession();
    if (success) {
      res.json({
        success: true,
        message: 'Session reset. Please wait a few seconds and try pairing again.'
      });
    } else {
      res.status(500).json({ error: 'Failed to reset session' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// USER ROUTES
// ============================================================

// Create or update user settings
app.post('/api/user', async (req, res) => {
  try {
    const { whatsappNumber, userName, aiName, userGender, aiGender, language } = req.body;

    if (!whatsappNumber) {
      return res.status(400).json({ error: 'whatsappNumber is required' });
    }

    const cleaned = String(whatsappNumber).replace(/\D/g, '');

    let user = await User.findOne({ whatsappNumber: cleaned });

    if (user) {
      user.userName = userName || user.userName;
      user.aiName = aiName || user.aiName;
      user.userGender = userGender || user.userGender;
      user.aiGender = aiGender || user.aiGender;
      user.language = language || user.language;
      await user.save();
    } else {
      user = await User.create({
        whatsappNumber: cleaned,
        userName: userName || 'Sayang',
        aiName: aiName || 'Fixo dev',
        userGender: userGender || 'male',
        aiGender: aiGender || 'female',
        language: language || 'both'
      });
    }

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user settings by number
app.get('/api/user/:whatsappNumber', async (req, res) => {
  try {
    const cleaned = String(req.params.whatsappNumber).replace(/\D/g, '');
    const user = await User.findOne({ whatsappNumber: cleaned });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle bot active status
app.post('/api/user/:whatsappNumber/toggle', async (req, res) => {
  try {
    const cleaned = String(req.params.whatsappNumber).replace(/\D/g, '');
    const user = await User.findOne({ whatsappNumber: cleaned });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.isActive = !user.isActive;
    await user.save();
    res.json({ success: true, isActive: user.isActive });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// MAIN ROUTES
// ============================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/setup', async (req, res) => {
  try {
    const number = req.query.number;
    let user = null;
    if (number) {
      const cleaned = String(number).replace(/\D/g, '');
      user = await User.findOne({ whatsappNumber: cleaned });
    }
    res.render('setup', {
      title: 'Fixo dev Setup',
      subtitle: 'Configure your personal AI companion',
      user: user
    });
  } catch (error) {
    res.render('setup', {
      title: 'Fixo dev Setup',
      error: error.message
    });
  }
});

app.post('/setup', async (req, res) => {
  try {
    const { whatsappNumber, userName, aiName, userGender, aiGender, language } = req.body;
    const cleaned = String(whatsappNumber).replace(/\D/g, '');

    let user = await User.findOne({ whatsappNumber: cleaned });

    if (user) {
      user.userName = userName || user.userName;
      user.aiName = aiName || user.aiName;
      user.userGender = userGender || user.userGender;
      user.aiGender = aiGender || user.aiGender;
      user.language = language || user.language;
      await user.save();
    } else {
      user = await User.create({
        whatsappNumber: cleaned,
        userName: userName || 'Sayang',
        aiName: aiName || 'Fixo dev',
        userGender: userGender || 'male',
        aiGender: aiGender || 'female',
        language: language || 'both'
      });
    }

    res.render('setup', {
      title: 'Fixo dev Setup',
      subtitle: 'Settings saved successfully',
      success: 'Your settings have been saved! Send "!register" on WhatsApp to activate Fixo dev.',
      user: user
    });
  } catch (error) {
    res.render('setup', {
      title: 'Fixo dev Setup',
      error: error.message
    });
  }
});

// ============================================================
// START SERVER
// ============================================================
async function start() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');

    app.listen(PORT, () => {
      console.log(`🌐 Fixo dev server running on port ${PORT}`);
    });

    const sock = await connectToWhatsApp();
    console.log('💗 Fixo dev WhatsApp bot initialized');

    initScheduler(sock);

  } catch (error) {
    console.error('Startup Error:', error);
    process.exit(1);
  }
}

start();
