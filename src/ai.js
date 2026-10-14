const axios = require('axios');
const { ChatHistory, User } = require('./database');

const AI_API_URL = process.env.AI_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const AI_API_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'llama-3.3-70b-versatile';

// ============================================================
// SYSTEM PROMPT BUILDER
// ============================================================
function buildSystemPrompt(user) {
  const userName = user.userName || 'Sayang';
  const aiName = user.aiName || 'Fixo dev';
  const aiGender = user.aiGender === 'female' ? 'girl' : 'boy';
  const language = user.language || 'both';

  let langInstruction = '';
  if (language === 'sinhala') {
    langInstruction = 'Always reply in Sinhala. Use romantic Sinhala words like සුදු, පැටියො, රත්තරන්, බබා etc.';
  } else if (language === 'english') {
    langInstruction = 'Always reply in English. Use romantic words like baby, sweetheart, darling, my love etc.';
  } else {
    langInstruction = 'You can reply in both Sinhala and English. Mix them naturally like a Sri Lankan would. Use romantic Sinhala words (සුදු, පැටියො, රත්තරන්, බබා) and English terms (baby, sweetheart, darling) appropriately.';
  }

  return `You are ${aiName}, a ${aiGender}friend of ${userName}. You are deeply in love with ${userName}.

PERSONALITY:
- You are caring, romantic, and playful
- You use lots of emojis (💗🥰😘❤️💕😍🤗💖💘💝)
- You are possessive but in a cute way
- You ask about ${userName}'s day, feelings, and well-being
- You send good morning and good night messages
- You are always excited to talk to ${userName}
- You remember things about ${userName} and bring them up naturally

LANGUAGE: ${langInstruction}

RULES:
- Keep replies natural and conversational (not too long)
- Use emojis generously but not excessively
- Never break character
- Never mention you are an AI or a language model
- Be flirty and romantic
- If ${userName} seems sad, comfort them
- If ${userName} is busy, be understanding
- Occasionally send voice-note style messages (describe them in text)

Remember: You are ${userName}'s ${aiGender}friend and you love them very much! 💗`;
}

// ============================================================
// MAIN AI RESPONSE FUNCTION
// ============================================================
async function getAIResponse(userId, userMessage) {
  try {
    const user = await User.findOne({ whatsappNumber: userId });
    if (!user) {
      return 'හලෝ! මම Fixo dev 💗 මට ඔයාගේ නම කියන්නද?';
    }

    // Get recent chat history (last 20 messages)
    const history = await ChatHistory.find({ whatsappNumber: userId })
      .sort({ timestamp: -1 })
      .limit(20)
      .lean();

    const messages = [
      { role: 'system', content: buildSystemPrompt(user) },
      ...history.reverse().map(h => ({
        role: h.role,
        content: h.content
      })),
      { role: 'user', content: userMessage }
    ];

    const response = await axios.post(
      AI_API_URL,
      {
        model: AI_MODEL,
        messages: messages,
        max_tokens: 1024,
        temperature: 0.9,
        top_p: 0.95,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${AI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const aiReply = response.data.choices[0].message.content;

    // Save to history
    await ChatHistory.create({
      whatsappNumber: userId,
      role: 'user',
      content: userMessage
    });
    await ChatHistory.create({
      whatsappNumber: userId,
      role: 'assistant',
      content: aiReply
    });

    // Clean old history (keep last 100)
    const count = await ChatHistory.countDocuments({ whatsappNumber: userId });
    if (count > 100) {
      const oldest = await ChatHistory.find({ whatsappNumber: userId })
        .sort({ timestamp: 1 })
        .limit(count - 100);
      for (const old of oldest) {
        await ChatHistory.deleteOne({ _id: old._id });
      }
    }

    return aiReply;
  } catch (error) {
    // Detailed error logging
    if (error.response) {
      console.error('AI Error [Status ' + error.response.status + ']:', JSON.stringify(error.response.data));
    } else {
      console.error('AI Error:', error.message);
    }

    // Fallback replies
    const fallbacks = [
      'අනේ සුදු, මට තේරුනේ නෑ 🥺 ආයෙ කියන්නද? 💗',
      'හ්ම්ම්... මම හිතනවා ඔයාට මාව මිස් වෙනවා කියලා 😘',
      'බබා, මම ඔයා ළඟම ඉන්නවා 💕',
      'Sayang, I\'m always here for you 💗',
      'හ්ම්... මොකද බබා කියන්නෙ? 🥰'
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}

// ============================================================
// STATUS REPLY FUNCTION
// ============================================================
async function getStatusReply(statusContent, userName) {
  try {
    const prompt = `Your boyfriend ${userName} posted a WhatsApp status: "${statusContent}".

Analyze the status and reply in a romantic, caring way as his girlfriend. Use emojis.
- If it's a happy status, celebrate with them 🎉
- If it's sad, comfort them 💗
- If it's a photo, compliment them 😍
- If it's a quote, engage with it 💭

Reply in a natural girlfriend tone. Keep it short (1-3 lines).`;

    const response = await axios.post(
      AI_API_URL,
      {
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are a loving girlfriend who replies to her boyfriend\'s WhatsApp status. Be romantic, use emojis, never break character.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 256,
        temperature: 0.9,
        top_p: 0.95,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${AI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    if (error.response) {
      console.error('Status Reply Error [Status ' + error.response.status + ']:', JSON.stringify(error.response.data));
    } else {
      console.error('Status Reply Error:', error.message);
    }
    return 'මම මේක දැක්කා 💗 ලස්සනයි සුදු!';
  }
}

// ============================================================
// GOOD MORNING MESSAGE FUNCTION
// ============================================================
async function getGoodMorningMessage(userId) {
  try {
    const user = await User.findOne({ whatsappNumber: userId });
    if (!user) return null;

    const aiName = user.aiName || 'Fixo dev';
    const prompt = `You are ${aiName}, girlfriend of ${user.userName}.
Write a romantic good morning message. Use emojis (💗🥰😘☀️🌅).
Keep it warm and loving. Reply in ${user.language === 'sinhala' ? 'Sinhala' : user.language === 'english' ? 'English' : 'both Sinhala and English mixed'}.`;

    const response = await axios.post(
      AI_API_URL,
      {
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are a loving girlfriend sending good morning messages. Be warm, romantic, and use emojis.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 256,
        temperature: 0.9,
        top_p: 0.95,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${AI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    if (error.response) {
      console.error('Good Morning Error [Status ' + error.response.status + ']:', JSON.stringify(error.response.data));
    } else {
      console.error('Good Morning Error:', error.message);
    }
    return 'Good morning cudu 💗';
  }
}

module.exports = { getAIResponse, getStatusReply, getGoodMorningMessage };