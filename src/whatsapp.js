const makeWASocket = require('fixo-baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('fixo-baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const { handleIncomingMessage } = require('./messageHandler');
const { handleStatusUpdate, handleStatusMessage } = require('./statusHandler');

let sock = null;
let isConnected = false;
let isSocketReady = false;
let currentPairingCode = null;
let pairingNumber = null;
let lastError = null;

const AUTH_FOLDER = 'auth_info_baileys';

// ============================================================
// SOCKET CONNECTION
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
    browser: ['AI Companion Bot', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    keepAliveIntervalMs: 30000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'connecting') {
      console.log('🔄 Socket connecting...');
    }

    if (connection === 'close') {
      isConnected = false;
      isSocketReady = false;
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('❌ Connection closed. Status:', statusCode, '| Reconnect:', shouldReconnect);

      if (shouldReconnect) {
        setTimeout(() => connectToWhatsApp(), 5000);
      }
    } else if (connection === 'open') {
      isConnected = true;
      isSocketReady = true;
      currentPairingCode = null;
      pairingNumber = null;
      lastError = null;
      console.log('✅ WhatsApp Bot Connected!');
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

  // Give the WebSocket time to establish
  await new Promise(resolve => setTimeout(resolve, 3000));
  isSocketReady = true;

  return sock;
}

// ============================================================
// WAIT FOR SOCKET READY
// ============================================================
async function waitForSocketReady(maxWaitMs = 15000) {
  const start = Date.now();
  while (!isSocketReady && Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 500));
  }
  if (!isSocketReady) {
    throw new Error('WhatsApp socket is not ready yet. Please wait a few seconds and try again.');
  }
}

// ============================================================
// CHECK EXISTING SESSION
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

// ============================================================
// CLEAR SESSION
// ============================================================
function clearSession() {
  try {
    if (fs.existsSync(AUTH_FOLDER)) {
      fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
      console.log('🗑️ Session cleared');
    }
    return true;
  } catch (e) {
    console.error('Failed to clear session:', e.message);
    return false;
  }
}

// ============================================================
// REQUEST PAIRING CODE
// ============================================================
async function requestPairingCode(phoneNumber) {
  lastError = null;

  if (!sock) {
    throw new Error('WhatsApp socket not initialized. Please wait and try again.');
  }

  if (isConnected) {
    throw new Error('Bot is already connected to a WhatsApp account. Disconnect first.');
  }

  if (sock.authState?.creds?.registered || hasExistingSession()) {
    throw new Error(
      'This session is already registered. Click "Reset Session" and try again.'
    );
  }

  await waitForSocketReady();

  const cleaned = String(phoneNumber).replace(/\D/g, '');

  if (cleaned.length < 10 || cleaned.length > 15) {
    throw new Error('Invalid phone number. Include country code without + (e.g., 94771234567)');
  }

  console.log(`🔑 Requesting pairing code for: ${cleaned}`);

  try {
    let code;

    if (typeof sock.requestPairingCode === 'function') {
      code = await sock.requestPairingCode(cleaned);
    } else if (typeof sock.requestPairingCodeV2 === 'function') {
      code = await sock.requestPairingCodeV2(cleaned);
    } else {
      throw new Error('requestPairingCode method not found on socket. Your baileys fork may not support it.');
    }

    if (!code) {
      throw new Error('Pairing code was empty. Try again.');
    }

    currentPairingCode = code;
    pairingNumber = cleaned;
    console.log(`✅ Pairing code generated: ${code}`);

    return { code, number: cleaned };
  } catch (error) {
    lastError = error.message;
    console.error('❌ Pairing code error:', error.message);
    console.error('Full error:', error);

    if (error.message?.includes('rate') || error.message?.includes('429')) {
      throw new Error('Too many requests. Please wait a few minutes and try again.');
    }
    if (error.message?.includes('already') || error.message?.includes('registered')) {
      throw new Error('This session is already registered. Click "Reset Session" and try again.');
    }
    if (error.message?.includes('timeout')) {
      throw new Error('Connection timeout. Please try again.');
    }

    throw new Error(`Failed to generate pairing code: ${error.message}`);
  }
}

// ============================================================
// RESET SESSION
// ============================================================
async function resetSession() {
  console.log('🔄 Resetting session...');
  try {
    if (sock) {
      try { sock.end(undefined); } catch (e) {}
      sock = null;
    }
    isConnected = false;
    isSocketReady = false;
    currentPairingCode = null;
    pairingNumber = null;
    lastError = null;
    clearSession();

    setTimeout(() => connectToWhatsApp(), 1000);
    return true;
  } catch (e) {
    console.error('Reset error:', e.message);
    return false;
  }
}

// ============================================================
// GET STATUS
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

function getSocket() {
  return sock;
}

module.exports = {
  connectToWhatsApp,
  getSocket,
  requestPairingCode,
  getStatus,
  resetSession,
  clearSession
};
