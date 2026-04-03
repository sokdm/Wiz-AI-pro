const axios = require('axios');
const { commands, registerCommand, reply } = require('./commands_part1');

// Helper function for AI responses (duplicate here to avoid circular dependency)
async function handleAIResponse(prompt, context = 'general') {
  try {
    let systemPrompt = 'You are a helpful assistant.';
    
    if (context === 'dm_conversation') {
      systemPrompt = `You are Wiz AI Pro, a friendly WhatsApp bot assistant. The owner is currently offline. 
Respond in a casual, warm Nigerian Pidgin English style like "I dey, how your side?" or "Wetin dey happen?". 
Be conversational, use emojis, and let them know the owner will reply soon. Keep responses short and friendly.`;
    }
    
    const response = await axios.post(process.env.DEEPSEEK_API_URL, {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 500
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.choices[0].message.content;
  } catch (err) {
    console.error('AI Error:', err.message);
    return 'AI service unavailable. Please try again later.';
  }
}

// 41. AI
registerCommand('ai', async (sock, msg, args, user) => {
  const prompt = args.join(' ');
  if (!prompt) return '❌ Ask me anything!';
  
  try {
    const response = await handleAIResponse(prompt, 'general');
    return `🤖 *AI Response:*\n\n${response}`;
  } catch (err) {
    return '❌ AI unavailable';
  }
}, { category: 'ai' });

// 42. GPT
registerCommand('gpt', async (sock, msg, args, user) => {
  return await commands['ai'].handler(sock, msg, args, user);
}, { category: 'ai' });

// 43. Imagine - AI Image Generation
registerCommand('imagine', async (sock, msg, args, user) => {
  const prompt = args.join(' ');
  if (!prompt) return '❌ Provide image description!';
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { 
      text: '🎨 Generating image...' 
    }, { quoted: msg });
    
    // Using Pollinations AI (free, no API key needed)
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    
    await sock.sendMessage(msg.key.remoteJid, { 
      image: Buffer.from(response.data),
      caption: `🎨 *Prompt:* ${prompt}\n\nPowered by Wiz AI Pro`
    }, { quoted: msg });
    
    return null;
  } catch (err) {
    console.error('Imagine error:', err);
    return '❌ Failed to generate image: ' + err.message;
  }
}, { category: 'ai' });

// 44. Translate
registerCommand('translate', async (sock, msg, args, user) => {
  if (args.length < 2) return '❌ Usage: .translate <lang> <text>\nExample: .translate es Hello world';
  
  const lang = args[0];
  const text = args.slice(1).join(' ');
  
  try {
    // Using MyMemory API (free)
    const res = await axios.get(`https://api.mymemory.translated.net/get`, {
      params: {
        q: text,
        langpair: `auto|${lang}`
      }
    });
    
    if (res.data.responseStatus === 200) {
      return `🌐 *Translation (${res.data.responseData.from} → ${lang}):*\n\n${res.data.responseData.translatedText}`;
    } else {
      // Fallback to Lingva
      const fallback = await axios.get(`https://lingva.ml/api/v1/auto/${lang}/${encodeURIComponent(text)}`);
      return `🌐 *Translation:*\n\n${fallback.data.translation}`;
    }
  } catch (err) {
    return '❌ Translation failed: ' + err.message;
  }
}, { category: 'ai' });

// 45. Summarize
registerCommand('summarize', async (sock, msg, args, user) => {
  const text = args.join(' ');
  if (!text && !msg.message.extendedTextMessage?.contextInfo?.quotedMessage) {
    return '❌ Provide text or reply to a message!';
  }
  
  let contentToSummarize = text;
  
  // If replying to a message, get that text
  if (!text && msg.message.extendedTextMessage?.contextInfo?.quotedMessage) {
    const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
    contentToSummarize = quoted.conversation || 
                         quoted.extendedTextMessage?.text || 
                         quoted.imageMessage?.caption ||
                         quoted.videoMessage?.caption || '';
  }
  
  if (!contentToSummarize) return '❌ No text found to summarize!';
  
  try {
    // Using AI to summarize
    const prompt = `Summarize this text in 3-5 bullet points:\n\n${contentToSummarize}`;
    const summary = await handleAIResponse(prompt, 'general');
    
    return `📝 *Summary:*\n\n${summary}`;
  } catch (err) {
    return '❌ Summarization failed: ' + err.message;
  }
}, { category: 'ai' });

// 46. Broadcast
registerCommand('broadcast', async (sock, msg, args, user) => {
  const message = args.join(' ');
  if (!message) return '❌ Provide message to broadcast!';
  
  try {
    // Get all chats
    const chats = await sock.groupFetchAllParticipating();
    const groups = Object.keys(chats);
    
    let sentCount = 0;
    
    // Send to all groups
    for (const groupId of groups) {
      try {
        await sock.sendMessage(groupId, { 
          text: `📢 *BROADCAST*\n\n${message}\n\n_Sent by Wiz AI Pro_` 
        });
        sentCount++;
        await new Promise(r => setTimeout(r, 1000)); // Delay to avoid rate limit
      } catch (e) {
        console.error(`Failed to send to ${groupId}:`, e.message);
      }
    }
    
    return `📢 Broadcast sent to ${sentCount} groups`;
  } catch (err) {
    return '❌ Broadcast failed: ' + err.message;
  }
}, { category: 'owner', ownerOnly: true });

// 47. Set PP - Set Profile Picture
registerCommand('setpp', async (sock, msg, args, user) => {
  const quoted = msg.message.extendedTextMessage?.contextInfo;
  if (!quoted) return '❌ Reply to an image!';
  
  try {
    const buffer = await downloadMediaMessage(
      {
        key: {
          remoteJid: msg.key.remoteJid,
          id: quoted.stanzaId,
          participant: quoted.participant
        },
        message: msg.message.extendedTextMessage.contextInfo.quotedMessage
      },
      'buffer',
      {},
      { logger: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {}, child: () => ({ info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {} }) } }
    );
    
    if (!buffer) return '❌ Failed to download image';
    
    await sock.updateProfilePicture(sock.user.id, buffer);
    return '🖼️ Profile picture updated!';
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'owner' });

// 48. Block
registerCommand('block', async (sock, msg, args, user) => {
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                 (args[0] ? args[0] + '@s.whatsapp.net' : null);
  if (!target) return '❌ Mention user or provide number!';
  
  await sock.updateBlockStatus(target, 'block');
  return '🚫 User blocked';
}, { category: 'owner' });

// 49. Unblock
registerCommand('unblock', async (sock, msg, args, user) => {
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                 (args[0] ? args[0] + '@s.whatsapp.net' : null);
  if (!target) return '❌ Mention user or provide number!';
  
  await sock.updateBlockStatus(target, 'unblock');
  return '✅ User unblocked';
}, { category: 'owner' });

// 50. Stats
registerCommand('stats', async (sock, msg, args, user) => {
  return `📊 *Bot Stats*\nCommands: 50+\nUptime: ${Math.floor(process.uptime())}s`;
}, { category: 'owner' });

// 51. Help
registerCommand('help', async (sock, msg, args, user) => {
  let text = `🤖 *WIZ AI PRO COMMANDS*\n\n`;
  text += `*Group:*\n.tagall, .hidetag, .kick, .add, .promote, .demote, .setname, .setdesc, .groupinfo, .link, .revoke, .antilink, .welcome, .goodbye, .mute, .unmute, .delete, .tagadmin, .everyone\n\n`;
  text += `*AI:*\n.ai, .gpt, .imagine, .translate, .summarize\n\n`;
  text += `*Media:*\n.sticker, .toimg, .vv, .save, .play, .ytsearch, .tiktok, .ig, .fb, .x\n\n`;
  text += `*Fun:*\n.joke, .quote, .roll, .flip, .choose, .rate, .gaycheck\n\n`;
  text += `*Utility:*\n.ping, .uptime, .serverinfo, .help\n\n`;
  text += `*Owner:*\n.broadcast, .setpp, .block, .unblock, .stats\n\n`;
  text += `📢 *Join Channel:*\nhttps://whatsapp.com/channel/0029VbCOs0vGU3BI6SYsDf17`;
  return text;
}, { category: 'utility' });

// 52. Menu
registerCommand('menu', async (sock, msg, args, user) => {
  return await commands['help'].handler(sock, msg, args, user);
}, { category: 'utility' });

module.exports = { commands };
