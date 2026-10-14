const makeWASocket = require('fixo-baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('fixo-baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const { handleIncomingMessage } = require('./messageHandler');
const { handleStatusUpdate, handleStatusMessage } = require('./statusHandler');

let sock = null;
let isConnected = false;
let currentPairingCode = null;
let pairingNumber = null;

// Store listeners for pairing events
const pairingListeners = [];

function onPairingUpdate(callback) {
  pairingListeners.push(callback);
}

function emitPairingUpdate(data) {
  pairingListeners.forEach(cb => {
    try { cb(data); } catch (e) { console.error('Listener error:', e); }
  });
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: false, // We use pairing code instead
    browser: ['AI Companion Bot', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    markOnlineOnConnect: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      isConnected = false;
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('❌ Connection closed. Status:', statusCode, '| Reconnect:', shouldReconnect);

      emitPairingUpdate({ event: 'closed', statusCode, shouldReconnect });

      if (shouldReconnect) {
        setTimeout(() => connectToWhatsApp(), 5000);
      }
    } else if (connection === 'open') {
      isConnected = true;
      currentPairingCode = null;
      pairingNumber = null;
      console.log('✅ WhatsApp Bot Connected!');
      emitPairingUpdate({ event: 'connected' });
    }
  });

  // Handle incoming messages
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

/**
 * Request a pairing code for a phone number.
 * Phone number must be in international format WITHOUT + (e.g. 94771234567)
 */
async function requestPairingCode(phoneNumber) {
  if (!sock) {
    throw new Error('WhatsApp socket not initialized');
  }

  if (isConnected) {
    throw new Error('Bot is already connected to a WhatsApp account');
  }

  if (sock.authState.creds.registered) {
    throw new Error('This session is already registered. Delete auth_info_baileys folder to re-pair.');
  }

  // Clean the number
  const cleaned = String(phoneNumber).replace(/\D/g, '');

  if (cleaned.length < 10 || cleaned.length > 15) {
    throw new Error('Invalid phone number. Include country code (e.g., 94771234567)');
  }

  try {
    const code = await sock.requestPairingCode(cleaned);
    currentPairingCode = code;
    pairingNumber = cleaned;

    console.log(`🔑 Pairing code for ${cleaned}: ${code}`);
    emitPairingUpdate({ event: 'pairing-code', code, number: cleaned });

    return { code, number: cleaned };
  } catch (error) {
    console.error('Pairing code error:', error.message);
    throw new Error('Failed to generate pairing code. Please try again.');
  }
}

function getStatus() {
  return {
    connected: isConnected,
    registered: sock?.authState?.creds?.registered || false,
    pairingCode: currentPairingCode,
    pairingNumber: pairingNumber
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
  onPairingUpdate
};