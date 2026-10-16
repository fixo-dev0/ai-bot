const makeWASocket = require('fixo-baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('fixo-baileys');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const { handleIncomingMessage } = require('./messageHandler');
const { handleStatusUpdate, handleStatusMessage } = require('./statusHandler');

let sock = null;
let isConnected = false;
let isSocketReady = false;       // true only after QR event
let currentPairingCode = null;
let pairingNumber = null;
let lastError = null;

const AUTH_FOLDER = 'auth_info_baileys';

// ============================================================
// CONNECT
// ============================================================
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  console.log('🚀 Initializing WhatsApp socket...');
  console.log('📦 Baileys version:', version.join('.'));

  sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Chrome (Linux)', 'Chrome', '120.0.0'],
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    keepAliveIntervalMs: 30000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr, isNewLogin } = update;

    // ✅ THE FIX: socket is truly ready when QR arrives
    if (qr) {
      console.log('📱 QR event received → socket is READY for pairing');
      isSocketReady = true;
    }

    if (connection === 'connecting') {
      console.log('🔄 Socket connecting...');
    }

    if (connection === 'open') {
      isConnected = true;
      isSocketReady = true;
      currentPairingCode = null;
      pairingNumber = null;
      lastError = null;
      console.log('✅ WhatsApp Bot Connected!');
    }

    if (connection === 'close') {
      isConnected = false;
      isSocketReady = false;
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Connection closed. Status:', statusCode, '| Reconnect:', shouldReconnect);
      if (shouldReconnect) setTimeout(() => connectToWhatsApp(), 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.remoteJid === 'status@broadcast') {
        await handleStatusMessage(sock, msg);
      } else {
        await handleIncomingMessage(sock, msg);
      }
    }
  });

  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      await handleStatusUpdate(sock, update);
    }
  });

  return sock;
}

// ============================================================
// WAIT FOR QR EVENT (the real readiness signal)
// ============================================================
async function waitForSocketReady(maxWaitMs = 30000) {
  if (isSocketReady) return;
  console.log('⏳ Waiting for socket to be ready (QR event)...');
  const start = Date.now();
  while (!isSocketReady && Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 300));
  }
  if (!isSocketReady) {
    throw new Error('Socket not ready yet. Wait a few seconds and try again.');
  }
  console.log('✅ Socket ready after', Date.now() - start, 'ms');
}

// ============================================================
// SESSION HELPERS
// ============================================================
function hasExistingSession() {
  try {
    const credsPath = path.join(AUTH_FOLDER, 'creds.json');
    if (!fs.existsSync(credsPath)) return false;
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    return creds?.registered === true;
  } catch (e) {
    return false;
  }
}

function clearSession() {
  try {
    if (fs.existsSync(AUTH_FOLDER)) {
      fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
      console.log('🗑️ Session cleared');
    }
    return true;
  } catch (e) {
    console.error('Clear session error:', e.message);
    return false;
  }
}

// ============================================================
// NORMALIZE NUMBER (critical)
// ============================================================
function normalizePhoneNumber(input) {
  let num = String(input).trim().replace(/\D/g, '');
  num = num.replace(/^0+/, '');  // remove leading zeros
  return num;
}

// ============================================================
// REQUEST PAIRING CODE
// ============================================================
async function requestPairingCode(phoneNumber) {
  lastError = null;

  if (!sock) throw new Error('Socket not initialized. Please wait.');

  if (isConnected) throw new Error('Bot is already connected.');

  if (sock.authState?.creds?.registered || hasExistingSession()) {
    throw new Error('Session already registered. Click "Reset Session" and try again.');
  }

  // ✅ Wait for REAL readiness (QR event)
  await waitForSocketReady();

  const cleaned = normalizePhoneNumber(phoneNumber);
  if (cleaned.length < 10 || cleaned.length > 15) {
    throw new Error('Invalid number. Use format like 94771234567 (no +, no leading 0).');
  }

  console.log(`🔑 Requesting pair code for: ${cleaned}`);

  try {
    const code = await sock.requestPairingCode(cleaned);

    if (!code || typeof code !== 'string') {
      throw new Error('Empty pairing code returned.');
    }

    currentPairingCode = code;
    pairingNumber = cleaned;
    console.log(`✅ Pairing code: ${code}`);
    return { code, number: cleaned };
  } catch (error) {
    lastError = error.message;
    console.error('❌ Pair error:', error.message);
    const msg = String(error.message || '').toLowerCase();

    if (msg.includes('rate') || msg.includes('429'))
      throw new Error('Too many attempts. Wait 5 minutes and try again.');
    if (msg.includes('already') || msg.includes('registered'))
      throw new Error('Session already registered. Click "Reset Session".');
    if (msg.includes('timeout'))
      throw new Error('Timeout. Try again in a moment.');

    throw new Error(`Pair code failed: ${error.message}`);
  }
}

// ============================================================
// RESET
// ============================================================
async function resetSession() {
  console.log('🔄 Resetting session...');
  try {
    if (sock) { try { sock.end(undefined); } catch (e) {} sock = null; }
    isConnected = false;
    isSocketReady = false;
    currentPairingCode = null;
    pairingNumber = null;
    lastError = null;
    clearSession();
    setTimeout(() => connectToWhatsApp(), 1500);
    return true;
  } catch (e) {
    console.error('Reset error:', e.message);
    return false;
  }
}

// ============================================================
// STATUS
// ============================================================
function getStatus() {
  return {
    connected: isConnected,
    socketReady: isSocketReady,
    registered: sock?.authState?.creds?.registered || hasExistingSession(),
    pairingCode: currentPairingCode,
    pairingNumber: pairingNumber,
    lastError: lastError
  };
}

function getSocket() { return sock; }

module.exports = {
  connectToWhatsApp,
  getSocket,
  requestPairingCode,
  getStatus,
  resetSession,
  clearSession
};
