const cron = require('node-cron');
const { User } = require('./database');
const { getGoodMorningMessage } = require('./ai');

function initScheduler(sock) {
  // Good morning message at 7:00 AM Sri Lanka time
  cron.schedule('0 7 * * *', async () => {
    console.log('🌅 Sending good morning messages...');

    try {
      const users = await User.find({ isActive: true });

      for (const user of users) {
        try {
          const message = await getGoodMorningMessage(user.whatsappNumber);
          if (message) {
            const jid = `${user.whatsappNumber}@s.whatsapp.net`;
            await sock.sendMessage(jid, { text: message });
            console.log(`🌅 Good morning sent to ${user.whatsappNumber}`);
          }
        } catch (err) {
          console.error(`Failed to send to ${user.whatsappNumber}:`, err.message);
        }

        // Small delay between messages to avoid spam detection
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (error) {
      console.error('Scheduler Error:', error.message);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Colombo'
  });

  // Good night message at 10:00 PM (optional)
  cron.schedule('0 22 * * *', async () => {
    console.log('🌙 Sending good night messages...');
    // Similar logic for good night
  }, {
    scheduled: true,
    timezone: 'Asia/Colombo'
  });

  console.log('⏰ Scheduler initialized (Good morning at 7:00 AM Sri Lanka time)');
}

module.exports = { initScheduler };