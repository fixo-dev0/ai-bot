const { getAIResponse } = require('./ai');
const { User, ChatHistory } = require('./database');

async function handleIncomingMessage(sock, msg) {
  try {
    // Ignore status broadcasts, groups, and own messages
    if (msg.key.remoteJid === 'status@broadcast') return;
    if (msg.key.remoteJid.endsWith('@g.us')) return;
    if (msg.key.fromMe) return;

    const senderJid = msg.key.remoteJid;
    const senderNumber = senderJid.split('@')[0];

    // Extract message text
    let messageText = '';
    if (msg.message?.conversation) {
      messageText = msg.message.conversation;
    } else if (msg.message?.extendedTextMessage?.text) {
      messageText = msg.message.extendedTextMessage.text;
    } else if (msg.message?.imageMessage?.caption) {
      messageText = msg.message.imageMessage.caption;
    } else if (msg.message?.videoMessage?.caption) {
      messageText = msg.message.videoMessage.caption;
    }

    if (!messageText) return;

    console.log(`📩 Message from ${senderNumber}: ${messageText}`);

    // Check if user is registered
    let user = await User.findOne({ whatsappNumber: senderNumber });

    // Handle commands
    if (messageText.toLowerCase() === '!register') {
      if (!user) {
        user = await User.create({
          whatsappNumber: senderNumber,
          userName: 'Sayang',
          aiName: 'Fixo dev',                          // ← Updated
          language: 'both'
        });
      }
      await sock.sendMessage(senderJid, {
        text: '✅ ඔයාව register කරගත්තා! 💗\n\nදැන් Fixo dev එක්ක chat කරන්න පුලුවන්.\n\n🌐 Dashboard: ' + (process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + process.env.PORT)
      });
      return;
    }

    // Handle help command
    if (messageText.toLowerCase() === '!help') {
      await sock.sendMessage(senderJid, {
        text: `💗 *Fixo dev Commands*\n\n` +
              `• *!register* — Register with the bot\n` +
              `• *!help* — Show this menu\n` +
              `• *!settings* — Get dashboard link\n\n` +
              `Just chat normally to talk with me 🥰`
      });
      return;
    }

    // Handle settings command
    if (messageText.toLowerCase() === '!settings') {
      const url = process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + process.env.PORT;
      await sock.sendMessage(senderJid, {
        text: `⚙️ *Update your settings here:*\n${url}\n\n💗 — Fixo dev`
      });
      return;
    }

    // If not registered, ask to register
    if (!user) {
      await sock.sendMessage(senderJid, {
        text: 'හලෝ! 💗 මම Fixo dev, ඔයාගේ AI girlfriend.\n\nමම එක්ක chat කරන්න `!register` කියලා type කරන්න 🥰'
      });
      return;
    }

    // Update last seen
    await User.updateOne(
      { whatsappNumber: senderNumber },
      { lastSeen: new Date() }
    );

    // Show typing indicator
    await sock.sendPresenceUpdate('composing', senderJid);

    // Get AI response
    const aiReply = await getAIResponse(senderNumber, messageText);

    // Stop typing
    await sock.sendPresenceUpdate('paused', senderJid);

    // Send reply
    await sock.sendMessage(senderJid, { text: aiReply });

    console.log(`🤖 Fixo dev reply to ${senderNumber}: ${aiReply}`);

  } catch (error) {
    console.error('Message Handler Error:', error.message);
  }
}

module.exports = { handleIncomingMessage };