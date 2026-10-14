const { getStatusReply } = require('./ai');
const { User, StatusSeen } = require('./database');

async function handleStatusUpdate(sock, update) {
  try {
    const { key, update: statusUpdate } = update;

    // Handle status read receipts
    if (statusUpdate.status === 3) { // 3 = read
      console.log('✅ Status seen:', key.remoteJid);
    }

    // Handle status message reactions
    if (statusUpdate.reaction) {
      console.log('❤️ Status reaction:', statusUpdate.reaction);
    }
  } catch (error) {
    console.error('Status Update Error:', error.message);
  }
}

async function handleStatusMessage(sock, msg) {
  try {
    const senderJid = msg.key.participant || msg.key.remoteJid;
    const senderNumber = senderJid.split('@')[0];

    // Check if user is registered
    const user = await User.findOne({ whatsappNumber: senderNumber });
    if (!user || !user.isActive) return;

    // Extract status content
    let statusContent = '';
    let statusType = 'text';

    if (msg.message?.conversation) {
      statusContent = msg.message.conversation;
    } else if (msg.message?.extendedTextMessage?.text) {
      statusContent = msg.message.extendedTextMessage.text;
    } else if (msg.message?.imageMessage) {
      statusType = 'image';
      statusContent = msg.message.imageMessage.caption || '[Photo]';
    } else if (msg.message?.videoMessage) {
      statusType = 'video';
      statusContent = msg.message.videoMessage.caption || '[Video]';
    }

    // Mark status as seen
    await sock.readMessages([msg.key]);
    console.log('👀 Status seen from:', senderNumber);

    // Check if already replied
    const statusId = msg.key.id;
    const alreadySeen = await StatusSeen.findOne({ statusId });
    if (alreadySeen?.replied) return;

    // Generate AI reply based on status
    const aiReply = await getStatusReply(statusContent, user.userName);

    // Send reaction first (random emoji)
    const reactions = ['❤️', '💗', '🥰', '😍', '💕', '😘'];
    const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];

    await sock.sendMessage(senderJid, {
      react: {
        text: randomReaction,
        key: msg.key
      }
    });

    // Send AI reply
    await sock.sendMessage(senderJid, {
      text: aiReply
    });

    // Mark as replied
    await StatusSeen.findOneAndUpdate(
      { statusId },
      { 
        statusId,
        senderNumber,
        content: statusContent,
        replied: true,
        seenAt: new Date()
      },
      { upsert: true }
    );

    console.log(`💬 Status reply sent to ${senderNumber}: ${aiReply}`);

  } catch (error) {
    console.error('Status Message Handler Error:', error.message);
  }
}

module.exports = { handleStatusUpdate, handleStatusMessage };