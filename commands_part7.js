const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { commands, registerCommand, getGroupMetadata } = require('./commands_part1');
const { getUser, saveEconomy } = require('./commands_part6');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const ffmpeg = require('fluent-ffmpeg');
const { pipeline } = require('stream/promises');
const FormData = require('form-data');

const TEMP_DIR = path.join(__dirname, 'temp');
fs.ensureDirSync(TEMP_DIR);

const PIDGIN_RESPONSES = {
  greetings: ['How far!', 'I dey!', 'Wetin dey happen!', 'How your side?', 'I dey hail o!'],
  how_are_you: ['I dey fine, thank God!', 'Body dey inside cloth!', 'We dey manage am!', 'I dey kampe!'],
  whats_up: ['Nothing much, just dey look!', 'Just dey here dey wait!', 'God dey provide!'],
  thanks: ['No wahala!', 'You do well!', 'Na we we!', 'God bless!'],
  bye: ['Deey go!', 'Later!', 'Make we see!', 'Bye bye!'],
  confused: ['I no understand wetin you talk o!', 'Abeg explain well well!', 'How you mean?']
};

function getRandomResponse(category) {
  const responses = PIDGIN_RESPONSES[category] || PIDGIN_RESPONSES.confused;
  return responses[Math.floor(Math.random() * responses.length)];
}

function detectIntent(text) {
  const lower = text.toLowerCase();
  if (/how far|how you dey|how e dey|sup|what's up/.test(lower)) return 'how_are_you';
  if (/good morning|good afternoon|good evening|hello|hi /.test(lower)) return 'greetings';
  if (/thank|thanks|tank you/.test(lower)) return 'thanks';
  if (/bye|good night|see you|later/.test(lower)) return 'bye';
  if (/wetin dey|what's happening|what dey happen/.test(lower)) return 'whats_up';
  return null;
}

registerCommand('chatbot', async (sock, msg, args, user) => {
  const groupId = msg.key.remoteJid;
  const action = args[0]?.toLowerCase();
  
  if (!global.chatbotGroups) global.chatbotGroups = new Set();
  if (!global.chatbotCooldown) global.chatbotCooldown = new Map();
  
  if (action === 'on') {
    global.chatbotGroups.add(groupId);
    return '🤖 Chatbot don start for this group! I go dey reply for Nigerian Pidgin.';
  }
  if (action === 'off') {
    global.chatbotGroups.delete(groupId);
    return '🔇 Chatbot don stop!';
  }
  
  return 'Usage: .chatbot on/off';
}, { category: 'ai', adminOnly: true });

registerCommand('ocr', async (sock, msg, args, user) => {
  const quoted = msg.message?.extendedTextMessage?.contextInfo;
  if (!quoted) return '❌ Reply to an image with .ocr';

  try {
    const buffer = await Promise.race([
      downloadMediaMessage(
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
        { logger: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {}, child: () => ({}) } }
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))
    ]);

    if (!buffer || buffer.length === 0) return '❌ Failed to download image';
    if (buffer.length > 1024 * 1024) return '❌ Image too large (max 1MB)';

    await sock.sendMessage(msg.key.remoteJid, { text: '🔍 Reading text...' }, { quoted: msg });

    const form = new FormData();
    form.append('file', buffer, { filename: 'image.png' });
    form.append('apikey', 'K88905258888957');
    form.append('language', 'eng');

    const res = await axios.post('https://api.ocr.space/parse/image', form, {
      headers: form.getHeaders(),
      timeout: 30000
    });

    if (res.data.IsErroredOnProcessing) throw new Error(res.data.ErrorMessage?.[0] || 'API error');

    const text = res.data.ParsedResults?.[0]?.ParsedText?.trim();
    if (!text) return '❌ No text found in image';

    return '📝 *OCR Result:*\n\n' + text;
  } catch (err) {
    return '❌ OCR failed: ' + err.message;
  }
}, { category: 'utility' });

registerCommand('imagine', async (sock, msg, args, user) => {
  const prompt = args.join(' ');
  if (!prompt) return '❌ Usage: .imagine <description>';

  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '🎨 Generating... (30-60s)' }, { quoted: msg });
    const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?width=1024&height=1024&nologo=true&seed=' + Date.now();
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    
    if (!res.data || res.data.length < 1000) throw new Error('Empty response');
    
    await sock.sendMessage(msg.key.remoteJid, {
      image: Buffer.from(res.data),
      caption: '🎨 *Generated Image*\n\nPrompt: ' + prompt
    }, { quoted: msg });
    return null;
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'ai' });

registerCommand('imaginefast', async (sock, msg, args, user) => {
  const prompt = args.join(' ');
  if (!prompt) return '❌ Usage: .imaginefast <description>';

  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '⚡ Generating...' }, { quoted: msg });
    const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?width=512&height=512&nologo=true&seed=' + Date.now();
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 45000 });
    
    if (!res.data || res.data.length < 1000) throw new Error('Empty');
    
    await sock.sendMessage(msg.key.remoteJid, {
      image: Buffer.from(res.data),
      caption: '⚡ *Fast Generated*\n\nPrompt: ' + prompt
    }, { quoted: msg });
    return null;
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'ai' });

registerCommand('imagineanime', async (sock, msg, args, user) => {
  const prompt = args.join(' ');
  if (!prompt) return '❌ Usage: .imagineanime <description>';

  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '🎌 Generating anime...' }, { quoted: msg });
    const animePrompt = 'anime style, ' + prompt + ', high quality, detailed';
    const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(animePrompt) + '?width=1024&height=1024&nologo=true&seed=' + Date.now();
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    
    await sock.sendMessage(msg.key.remoteJid, {
      image: Buffer.from(res.data),
      caption: '🎌 *Anime Style*\n\nPrompt: ' + prompt
    }, { quoted: msg });
    return null;
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'ai' });

registerCommand('imaginereal', async (sock, msg, args, user) => {
  const prompt = args.join(' ');
  if (!prompt) return '❌ Usage: .imaginereal <description>';

  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '📸 Generating realistic photo...' }, { quoted: msg });
    const realPrompt = 'photorealistic, ' + prompt + ', 8k, detailed, professional photography';
    const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(realPrompt) + '?width=1024&height=1024&nologo=true&seed=' + Date.now();
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    
    await sock.sendMessage(msg.key.remoteJid, {
      image: Buffer.from(res.data),
      caption: '📸 *Photorealistic*\n\nPrompt: ' + prompt
    }, { quoted: msg });
    return null;
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'ai' });

registerCommand('playvn', async (sock, msg, args, user) => {
  const query = args.join(' ');
  if (!query) return '❌ Usage: .playvn <song name>\nExample: .playvn Burna Boy Last Last';

  try {
    await sock.sendMessage(msg.key.remoteJid, { 
      text: '🔍 Searching for "' + query + '"...\n\n⏳ This may take 30-60 seconds' 
    }, { quoted: msg });

    // Try Deezer API first
    let track = null;
    try {
      const deezerRes = await axios.get('https://api.deezer.com/search?q=' + encodeURIComponent(query) + '&limit=1', { timeout: 10000 });
      if (deezerRes.data && deezerRes.data.data && deezerRes.data.data.length > 0) {
        track = deezerRes.data.data[0];
      }
    } catch (e) {
      console.log('Deezer failed, trying iTunes');
    }

    // Fallback to iTunes
    if (!track) {
      try {
        const itunesRes = await axios.get('https://itunes.apple.com/search?term=' + encodeURIComponent(query) + '&limit=1&media=music', { timeout: 10000 });
        if (itunesRes.data && itunesRes.data.results && itunesRes.data.results.length > 0) {
          const t = itunesRes.data.results[0];
          track = {
            title: t.trackName,
            artist: { name: t.artistName },
            preview: t.previewUrl
          };
        }
      } catch (e) {
        console.log('iTunes also failed');
      }
    }

    if (!track) {
      return '❌ Could not find "' + query + '"\n\n🔍 Try:\n• YouTube: https://www.youtube.com/results?search_query=' + encodeURIComponent(query) + '\n• Spotify: https://open.spotify.com/search/' + encodeURIComponent(query);
    }

    if (!track.preview) {
      return '❌ No preview available for: ' + track.title + '\n\nTry a different song or use .spotify to find links.';
    }

    await sock.sendMessage(msg.key.remoteJid, { 
      text: '🎵 Found: ' + track.title + ' by ' + track.artist.name + '\nDownloading 30s preview...' 
    }, { quoted: msg });

    const audioRes = await axios.get(track.preview, { 
      responseType: 'arraybuffer',
      timeout: 30000
    });

    const tempMp3 = path.join(TEMP_DIR, Date.now() + '_preview.mp3');
    const tempOgg = path.join(TEMP_DIR, Date.now() + '_preview.ogg');
    
    await fs.writeFile(tempMp3, audioRes.data);

    await new Promise((resolve, reject) => {
      ffmpeg(tempMp3)
        .toFormat('opus')
        .audioBitrate(64)
        .on('end', resolve)
        .on('error', reject)
        .save(tempOgg);
    });

    const audioBuffer = await fs.readFile(tempOgg);
    
    await sock.sendMessage(msg.key.remoteJid, {
      audio: audioBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
      fileName: track.title + '.ogg'
    }, { quoted: msg });

    await fs.remove(tempMp3);
    await fs.remove(tempOgg);

    return null;

  } catch (err) {
    console.error('PlayVN error:', err);
    return '❌ Failed: ' + err.message + '\n\nTry:\n• Check spelling\n• Try: .playvn "artist name song name"\n• Or use .spotify to find links';
  }
}, { category: 'media' });

registerCommand('dlvn', async (sock, msg, args, user) => {
  const url = args[0];
  if (!url || !url.startsWith('http')) return '❌ Usage: .dlvn <direct mp3 url>\n\nThis downloads audio from a direct link and sends as voice note.';

  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '🔊 Downloading audio...' }, { quoted: msg });

    const res = await axios.get(url, { 
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024
    });

    const tempMp3 = path.join(TEMP_DIR, Date.now() + '.mp3');
    const tempOgg = path.join(TEMP_DIR, Date.now() + '.ogg');
    
    await fs.writeFile(tempMp3, res.data);

    await new Promise((resolve, reject) => {
      ffmpeg(tempMp3).toFormat('opus').audioBitrate(64).on('end', resolve).on('error', reject).save(tempOgg);
    });

    const audioBuffer = await fs.readFile(tempOgg);
    
    await sock.sendMessage(msg.key.remoteJid, {
      audio: audioBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true
    }, { quoted: msg });

    await fs.remove(tempMp3);
    await fs.remove(tempOgg);

    return null;

  } catch (err) {
    return '❌ Download failed: ' + err.message;
  }
}, { category: 'media' });

registerCommand('spotify', async (sock, msg, args, user) => {
  const query = args.join(' ');
  if (!query) return '❌ Usage: .spotify <song/artist name>\nExample: .spotify Burna Boy Last Last';

  try {
    const webUrl = 'https://open.spotify.com/search/' + encodeURIComponent(query);
    
    const itunesRes = await axios.get(
      'https://itunes.apple.com/search?term=' + encodeURIComponent(query) + '&limit=5&media=music',
      { timeout: 10000 }
    );

    let text = '🎵 *Spotify Search*\n\nQuery: "' + query + '"\n\n🔗 ' + webUrl + '\n\n';
    
    if (itunesRes.data && itunesRes.data.results && itunesRes.data.results.length > 0) {
      text = text + '*Top Results:*\n\n';
      itunesRes.data.results.slice(0, 3).forEach((track, i) => {
        text = text + (i+1) + '. *' + track.trackName + '*\n   Artist: ' + track.artistName + '\n   Preview: ' + (track.previewUrl ? 'Available (30s)' : 'Not available') + '\n\n';
      });
    }

    text = text + '\n💡 *To download:*\n1. Open Spotify/YouTube link\n2. Copy song URL\n3. Use .dlvn <url> if direct link available\n\nOr try: .playvn "' + query + '" for 30s preview';

    await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
    return null;

  } catch (err) {
    return '🎵 *Spotify Search*\n\nhttps://open.spotify.com/search/' + encodeURIComponent(query) + '\n\nTry .playvn "' + query + '" for audio preview!';
  }
}, { category: 'media' });

registerCommand('toaudio', async (sock, msg, args, user) => {
  const quoted = msg.message?.extendedTextMessage?.contextInfo;
  if (!quoted) return '❌ Reply to a video with .toaudio';

  const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
  const isVideo = qMsg.videoMessage || qMsg.documentMessage?.mimetype?.startsWith('video');
  if (!isVideo) return '❌ Not a video!';

  const tempFiles = [];

  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '🔊 Processing...' }, { quoted: msg });

    const buffer = await downloadMediaMessage(
      {
        key: { remoteJid: msg.key.remoteJid, id: quoted.stanzaId, participant: quoted.participant },
        message: qMsg
      },
      'buffer',
      {},
      { logger: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {}, child: () => ({}) } }
    );

    if (!buffer || buffer.length > 50 * 1024 * 1024) return '❌ Too large (max 50MB)';

    const tempVideo = path.join(TEMP_DIR, Date.now() + '_video.mp4');
    const tempAudio = path.join(TEMP_DIR, Date.now() + '_audio.ogg');
    tempFiles.push(tempVideo, tempAudio);

    await fs.writeFile(tempVideo, buffer);

    await new Promise((resolve, reject) => {
      ffmpeg(tempVideo).noVideo().audioCodec('libopus').audioBitrate(64).format('ogg').on('end', resolve).on('error', reject).save(tempAudio);
    });

    const audioBuffer = await fs.readFile(tempAudio);
    await sock.sendMessage(msg.key.remoteJid, {
      audio: audioBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true
    }, { quoted: msg });

    for (const f of tempFiles) try { await fs.remove(f); } catch {}
    return null;

  } catch (err) {
    for (const f of tempFiles) try { await fs.remove(f); } catch {}
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

registerCommand('tomp3', async (sock, msg, args, user) => {
  const quoted = msg.message?.extendedTextMessage?.contextInfo;
  if (!quoted) return '❌ Reply to a video with .tomp3';

  const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
  const isVideo = qMsg.videoMessage || qMsg.documentMessage?.mimetype?.startsWith('video');
  if (!isVideo) return '❌ Not a video!';

  const tempFiles = [];

  try {
    const buffer = await downloadMediaMessage(
      {
        key: { remoteJid: msg.key.remoteJid, id: quoted.stanzaId, participant: quoted.participant },
        message: qMsg
      },
      'buffer',
      {},
      { logger: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {}, child: () => ({}) } }
    );

    const tempVideo = path.join(TEMP_DIR, Date.now() + '_video.mp4');
    const tempMp3 = path.join(TEMP_DIR, Date.now() + '_audio.mp3');
    tempFiles.push(tempVideo, tempMp3);

    await fs.writeFile(tempVideo, buffer);

    await new Promise((resolve, reject) => {
      ffmpeg(tempVideo).noVideo().audioCodec('libmp3lame').audioBitrate(128).format('mp3').on('end', resolve).on('error', reject).save(tempMp3);
    });
const audioBuffer = await fs.readFile(tempMp3);
    await sock.sendMessage(msg.key.remoteJid, {
      document: audioBuffer,
      mimetype: 'audio/mpeg',
      fileName: 'audio.mp3'
    }, { quoted: msg });

    for (const f of tempFiles) try { await fs.remove(f); } catch {}
    return null;

  } catch (err) {
    for (const f of tempFiles) try { await fs.remove(f); } catch {}
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

registerCommand('tts', async (sock, msg, args, user) => {
  const lang = args[0] || 'en';
  const text = args.slice(1).join(' ') || 'Hello from Wiz AI Pro';
  
  if (text.length > 200) return '❌ Max 200 characters';
  
  try {
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&q=' + encodeURIComponent(text) + '&tl=' + lang + '&client=tw-ob';
    
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://translate.google.com/'
      }
    });

    if (!res.data || res.data.length < 100) {
      throw new Error('Empty audio response');
    }

    await sock.sendMessage(msg.key.remoteJid, {
      audio: Buffer.from(res.data),
      mimetype: 'audio/mp3',
      ptt: true
    }, { quoted: msg });
    
    return null;
    
  } catch (err) {
    try {
      const fallbackUrl = 'https://api.streamelements.com/kappa/v2/speech?voice=Joanna&text=' + encodeURIComponent(text);
      const fallback = await axios.get(fallbackUrl, {
        responseType: 'arraybuffer',
        timeout: 10000
      });
      
      await sock.sendMessage(msg.key.remoteJid, {
        audio: Buffer.from(fallback.data),
        mimetype: 'audio/mp3',
        ptt: true
      }, { quoted: msg });
      
      return null;
    } catch (fallbackErr) {
      return '❌ TTS failed: ' + err.message;
    }
  }
}, { category: 'utility' });

registerCommand('remind', async (sock, msg, args, user) => {
  const timeStr = args[0];
  const text = args.slice(1).join(' ');
  if (!timeStr || !text) return '❌ Usage: .remind 30m Check oven\n\nTime: 30s, 5m, 2h, 1d';
  
  const match = timeStr.match(/^(\d+)([smhd])$/);
  if (!match) return '❌ Use: 30s, 5m, 2h, or 1d';
  
  const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]] * parseInt(match[1]);
  const userId = msg.key.participant || msg.key.remoteJid;
  
  setTimeout(async () => {
    await sock.sendMessage(userId, { text: '⏰ *REMINDER*\n\n' + text });
  }, ms);
  
  return '⏰ Reminder set for ' + timeStr + '!';
}, { category: 'utility' });

registerCommand('weather', async (sock, msg, args, user) => {
  const city = args.join(' ');
  if (!city) return '❌ Provide city name';
  
  try {
    const res = await axios.get('https://wttr.in/' + encodeURIComponent(city) + '?format=3', {
      headers: { 'User-Agent': 'curl' },
      timeout: 10000
    });
    return '🌤️ *Weather*\n\n' + res.data;
  } catch (err) {
    return '❌ Weather unavailable';
  }
}, { category: 'utility' });

registerCommand('calc', async (sock, msg, args, user) => {
  const expr = args.join(' ');
  if (!expr) return '❌ Usage: .calc 2+2*5';
  
  try {
    const clean = expr.replace(/[^0-9+\-*/.() ]/g, '');
    if (!clean) return '❌ Invalid characters';
    const result = Function('"use strict";return (' + clean + ')')();
    return '🧮 ' + clean + ' = ' + result;
  } catch {
    return '❌ Invalid expression';
  }
}, { category: 'utility' });

registerCommand('qr', async (sock, msg, args, user) => {
  const text = args.join(' ');
  if (!text) return '❌ Provide text';
  
  try {
    const res = await axios.get('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(text), {
      responseType: 'arraybuffer',
      timeout: 15000
    });
    await sock.sendMessage(msg.key.remoteJid, {
      image: Buffer.from(res.data),
      caption: '📱 QR Code'
    }, { quoted: msg });
    return null;
  } catch (err) {
    return '❌ QR generation failed';
  }
}, { category: 'utility' });

registerCommand('marry', async (sock, msg, args, user) => {
  const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return '❌ Mention your soulmate!';
  if (target === msg.key.participant) return '❌ You cannot marry yourself!';
  
  return '💍 @' + msg.key.participant.split('@')[0] + ' wants to marry @' + target.split('@')[0] + '!\n\n_' + target.split('@')[0] + ' must reply with .acceptmarry to accept!_';
}, { category: 'fun' });

registerCommand('acceptmarry', async (sock, msg, args, user) => {
  return '💕 *Congratulations!* You are now married! 🎉';
}, { category: 'fun' });

registerCommand('divorce', async (sock, msg, args, user) => {
  return '💔 *Divorced!* You are now single again. 😅';
}, { category: 'fun' });

module.exports = { 
  commands,
  PIDGIN_RESPONSES,
  detectIntent,
  getRandomResponse
};
