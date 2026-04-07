const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { commands, registerCommand, getGroupMetadata } = require('./commands_part1');
const { getUser, saveEconomy } = require('./commands_part6');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const ffmpeg = require('fluent-ffmpeg');
const crypto = require('crypto');
const os = require('os');

const TEMP_DIR = path.join(__dirname, 'temp');
fs.ensureDirSync(TEMP_DIR);

const ownerStatusMap = new Map();
const tttGames = new Map();

const tagallEmojiIndex = new Map();

const tagallEmojis = ['💠', '🧩', '🔥', '⚡', '🎯', '💎', '🚀', '⭐', '💪', '👑', '🎉', '❤️', '🌟', '✨', '🔮', '🎨', '🎭', '🎪', '🎲', '🎰'];

const LANGUAGES = {
  'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
  'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'ja': 'Japanese',
  'ko': 'Korean', 'zh': 'Chinese', 'ar': 'Arabic', 'hi': 'Hindi',
  'tr': 'Turkish', 'pl': 'Polish', 'nl': 'Dutch', 'sv': 'Swedish',
  'id': 'Indonesian', 'vi': 'Vietnamese', 'th': 'Thai', 'ms': 'Malay'
};

function getNextTagallEmoji(groupId) {
  const currentIndex = tagallEmojiIndex.get(groupId) || 0;
  const emoji = tagallEmojis[currentIndex % tagallEmojis.length];
  tagallEmojiIndex.set(groupId, (currentIndex + 1) % tagallEmojis.length);
  return emoji;
}

function isOwner(user, msg) {
  const ownerPhone = user && user.whatsappSession && user.whatsappSession.phone ? user.whatsappSession.phone.toString().replace(/\D/g, '') : '';
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderPhone = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
  return ownerPhone === senderPhone;
}

registerCommand('tagall', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '📢', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const text = args.join(' ') || '👋 Attention everyone!';
  const groupMeta = await getGroupMetadata(sock, groupId);
  const mentions = groupMeta.participants.map(p => p.id);
  const totalMembers = groupMeta.participants.length;
  
  const emoji = getNextTagallEmoji(groupId);
  
  let tagList = '';
  groupMeta.participants.forEach((p) => {
    const phone = p.id.split('@')[0].split(':')[0];
    tagList += emoji + ' @' + phone + '\n';
  });
  
  const message = `╔═══❖•ೋ° °ೋ•❖═══╗
┃   📢 TAGALL
╚═══❖•ೋ° °ೋ•❖═══╝

📝 *Message:* ${text}
👥 *Total Members:* ${totalMembers}
⏰ *Tagged by:* @${(msg.key.participant || msg.key.remoteJid).split('@')[0].split(':')[0]}

${tagList}`;
  
  await sock.sendMessage(groupId, { 
    text: message,
    mentions: mentions 
  });
  return null;
}, { category: 'group', adminOnly: true });

registerCommand('vv', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '👁️', key: msg.key } });
  const quoted = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
  if (!quoted) return '❌ Reply to a view-once image/video with .vv';
  
  const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
  const isViewOnceImage = qMsg.imageMessage && qMsg.imageMessage.viewOnce === true;
  const isViewOnceVideo = qMsg.videoMessage && qMsg.videoMessage.viewOnce === true;
  
  if (!isViewOnceImage && !isViewOnceVideo) {
    return commands['save'].handler(sock, msg, args, user);
  }
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { text: '⏳ Saving view-once media...' }, { quoted: msg });
    
    const buffer = await downloadMediaMessage(
      {
        key: { 
          remoteJid: msg.key.remoteJid, 
          id: quoted.stanzaId, 
          participant: quoted.participant 
        },
        message: qMsg
      },
      'buffer',
      {},
      { 
        logger: { 
          info: () => {}, 
          error: () => {}, 
          debug: () => {}, 
          warn: () => {}, 
          trace: () => {}, 
          fatal: () => {}, 
          child: () => ({}) 
        } 
      }
    );
    
    if (!buffer) return '❌ Failed to download media';
    
    const caption = '✅ View-once media saved!';
    
    if (isViewOnceImage) {
      await sock.sendMessage(msg.key.remoteJid, { 
        image: buffer, 
        caption: caption 
      }, { quoted: msg });
    } else if (isViewOnceVideo) {
      await sock.sendMessage(msg.key.remoteJid, { 
        video: buffer, 
        caption: caption 
      }, { quoted: msg });
    }
    
    return null;
  } catch (err) {
    console.error('VV error:', err);
    return '❌ Failed to save view-once media. It may have expired.';
  }
}, { category: 'media' });

registerCommand('save', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '💾', key: msg.key } });
  const quoted = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
  if (!quoted) return '❌ Reply to media with .save';
  
  const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
  
  const hasImage = qMsg.imageMessage || (qMsg.extendedTextMessage && qMsg.extendedTextMessage.contextInfo && qMsg.extendedTextMessage.contextInfo.quotedMessage && qMsg.extendedTextMessage.contextInfo.quotedMessage.imageMessage);
  const hasVideo = qMsg.videoMessage || (qMsg.extendedTextMessage && qMsg.extendedTextMessage.contextInfo && qMsg.extendedTextMessage.contextInfo.quotedMessage && qMsg.extendedTextMessage.contextInfo.quotedMessage.videoMessage);
  const hasAudio = qMsg.audioMessage || (qMsg.extendedTextMessage && qMsg.extendedTextMessage.contextInfo && qMsg.extendedTextMessage.contextInfo.quotedMessage && qMsg.extendedTextMessage.contextInfo.quotedMessage.audioMessage);
  const hasDocument = qMsg.documentMessage || (qMsg.extendedTextMessage && qMsg.extendedTextMessage.contextInfo && qMsg.extendedTextMessage.contextInfo.quotedMessage && qMsg.extendedTextMessage.contextInfo.quotedMessage.documentMessage);
  const hasSticker = qMsg.stickerMessage || (qMsg.extendedTextMessage && qMsg.extendedTextMessage.contextInfo && qMsg.extendedTextMessage.contextInfo.quotedMessage && qMsg.extendedTextMessage.contextInfo.quotedMessage.stickerMessage);
  
  let mediaType = null;
  let actualMsg = qMsg;
  
  if (hasImage) {
    mediaType = 'image';
    actualMsg = qMsg.imageMessage ? qMsg : { imageMessage: qMsg.extendedTextMessage.contextInfo.quotedMessage.imageMessage };
  } else if (hasVideo) {
    mediaType = 'video';
    actualMsg = qMsg.videoMessage ? qMsg : { videoMessage: qMsg.extendedTextMessage.contextInfo.quotedMessage.videoMessage };
  } else if (hasAudio) {
    mediaType = 'audio';
    actualMsg = qMsg.audioMessage ? qMsg : { audioMessage: qMsg.extendedTextMessage.contextInfo.quotedMessage.audioMessage };
  } else if (hasDocument) {
    mediaType = 'document';
    actualMsg = qMsg.documentMessage ? qMsg : { documentMessage: qMsg.extendedTextMessage.contextInfo.quotedMessage.documentMessage };
  } else if (hasSticker) {
    mediaType = 'sticker';
    actualMsg = qMsg.stickerMessage ? qMsg : { stickerMessage: qMsg.extendedTextMessage.contextInfo.quotedMessage.stickerMessage };
  }
  
  if (!mediaType) {
    return '❌ No media found! Make sure you reply to an image, video, audio, or document.';
  }
  
  try {
    const buffer = await downloadMediaMessage(
      {
        key: { 
          remoteJid: msg.key.remoteJid, 
          id: quoted.stanzaId, 
          participant: quoted.participant 
        },
        message: actualMsg
      },
      'buffer',
      {},
      { 
        logger: { 
          info: () => {}, 
          error: () => {}, 
          debug: () => {}, 
          warn: () => {}, 
          trace: () => {}, 
          fatal: () => {}, 
          child: () => ({}) 
        } 
      }
    );
    
    if (!buffer) return '❌ Failed to download media';
    
    const caption = '✅ Media saved and re-sent!';
    
    if (mediaType === 'image') {
      await sock.sendMessage(msg.key.remoteJid, { image: buffer, caption: caption }, { quoted: msg });
    } else if (mediaType === 'video') {
      await sock.sendMessage(msg.key.remoteJid, { video: buffer, caption: caption }, { quoted: msg });
    } else if (mediaType === 'audio') {
      const isVoice = actualMsg.audioMessage && actualMsg.audioMessage.ptt ? true : false;
      await sock.sendMessage(msg.key.remoteJid, { 
        audio: buffer, 
        mimetype: 'audio/mp4', 
        ptt: isVoice 
      }, { quoted: msg });
    } else if (mediaType === 'document') {
      const fileName = actualMsg.documentMessage && actualMsg.documentMessage.fileName ? actualMsg.documentMessage.fileName : 'saved_file';
      await sock.sendMessage(msg.key.remoteJid, { 
        document: buffer, 
        fileName: fileName,
        caption: caption
      }, { quoted: msg });
    } else if (mediaType === 'sticker') {
      await sock.sendMessage(msg.key.remoteJid, { 
        sticker: buffer 
      }, { quoted: msg });
    }
    
    return null;
  } catch (err) {
    return '❌ Failed to save media: ' + err.message;
  }
}, { category: 'media' });

registerCommand('sticker', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🎨', key: msg.key } });
  const quoted = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
  if (!quoted) return '❌ Reply to an image with .sticker';
  
  const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
  const isImage = qMsg.imageMessage || (qMsg.documentMessage && qMsg.documentMessage.mimetype && qMsg.documentMessage.mimetype.startsWith('image'));
  
  if (!isImage) return '❌ Reply to an image!';
  
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
    
    await sock.sendMessage(msg.key.remoteJid, {
      sticker: buffer,
      mimetype: 'image/webp'
    }, { quoted: msg });
    
    return null;
  } catch (err) {
    return '❌ Failed to create sticker';
  }
}, { category: 'media' });

registerCommand('toimg', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🖼️', key: msg.key } });
  const quoted = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
  if (!quoted) return '❌ Reply to a sticker with .toimg';
  
  const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
  if (!qMsg.stickerMessage) return '❌ Not a sticker!';
  
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
    
    await sock.sendMessage(msg.key.remoteJid, {
      image: buffer,
      caption: '🖼️ Sticker converted to image'
    }, { quoted: msg });
    
    return null;
  } catch (err) {
    return '❌ Failed to convert sticker';
  }
}, { category: 'media' });

registerCommand('play', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🎵', key: msg.key } });
  const query = args.join(' ');
  if (!query) return '❌ Usage: .play <song name>';
  return commands['playvn'].handler(sock, msg, args, user);
}, { category: 'media' });

registerCommand('ytsearch', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔍', key: msg.key } });
  const query = args.join(' ');
  if (!query) return '❌ Usage: .ytsearch <query>';
  
  try {
    const res = await axios.get(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&key=AIzaSyDemoKey&type=video&maxResults=5`, {
      timeout: 15000
    });
    
    if (!res.data.items || res.data.items.length === 0) throw new Error('No results');
    
    const videos = res.data.items.map((v, i) => 
      `${i+1}. ${v.snippet.title}\n   👤 ${v.snippet.channelTitle}\n   🆔 ${v.id.videoId}`
    ).join('\n\n');
    
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🎬 YOUTUBE SEARCH
╚═══❖•ೋ° °ೋ•❖═══╝

${videos}`;
  } catch (err) {
    return `🔍 YouTube Search\n\nhttps://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  }
}, { category: 'media' });

registerCommand('tiktok', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🎵', key: msg.key } });
  const url = args[0];
  if (!url || !url.includes('tiktok.com')) return '❌ Usage: .tiktok <tiktok url>';
  return '⏳ TikTok download is processing...\n\nUse online downloader:\nhttps://ssstik.io';
}, { category: 'media' });

registerCommand('ig', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '📸', key: msg.key } });
  const url = args[0];
  if (!url || !url.includes('instagram.com')) return '❌ Usage: .ig <instagram url>';
  return '⏳ Instagram download is processing...\n\nUse online downloader:\nhttps://snapinsta.app';
}, { category: 'media' });

registerCommand('fb', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '👍', key: msg.key } });
  const url = args[0];
  if (!url || !url.includes('facebook.com')) return '❌ Usage: .fb <facebook url>';
  return '⏳ Facebook download is processing...\n\nUse online downloader:\nhttps://fdown.net';
}, { category: 'media' });

registerCommand('x', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🐦', key: msg.key } });
  const url = args[0];
  if (!url || (!url.includes('twitter.com') && !url.includes('x.com'))) return '❌ Usage: .x <twitter/x url>';
  return '⏳ Twitter/X download is processing...\n\nUse online downloader:\nhttps://twitsave.com';
}, { category: 'media' });

registerCommand('lyrics', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🎤', key: msg.key } });
  const query = args.join(' ');
  if (!query) return '❌ Usage: .lyrics <song name>';
  
  try {
    const res = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(query)}`, {
      timeout: 15000
    });
    
    const lyrics = res.data.lyrics ? res.data.lyrics.substring(0, 1500) : 'Lyrics not found';
    return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🎵 LYRICS
╚═══❖•ೋ° °ೋ•❖═══╝

${query}

${lyrics}${res.data.lyrics && res.data.lyrics.length > 1500 ? '\n\n... (truncated)' : ''}`;
  } catch (err) {
    return `❌ Lyrics not found for "${query}"\n\nTry searching on Genius.com`;
  }
}, { category: 'media' });

registerCommand('pinterest', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '📌', key: msg.key } });
  const query = args.join(' ');
  if (!query) return '❌ Usage: .pinterest <search>';
  return `🔍 Pinterest Search\n\nhttps://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
}, { category: 'media' });

registerCommand('hidetag', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '👻', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const text = args.join(' ') || '👋 Attention everyone!';
  const groupMeta = await getGroupMetadata(sock, groupId);
  const mentions = groupMeta.participants.map(p => p.id);
  
  await sock.sendMessage(groupId, { 
    text: text,
    mentions: mentions 
  });
  return null;
}, { category: 'group', adminOnly: true });

registerCommand('tagadmin', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '👑', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const groupMeta = await getGroupMetadata(sock, groupId);
  const admins = groupMeta.participants.filter(p => 
    p.admin === 'admin' || p.admin === 'superadmin'
  );
  
  if (admins.length === 0) return '❌ No admins found!';
  
  const mentions = admins.map(p => p.id);
  const text = args.join(' ') || '📢 Calling all admins!';
  
  await sock.sendMessage(groupId, { 
    text: text + '\n\n' + admins.map(a => '@' + a.id.split('@')[0].split(':')[0]).join(' '),
    mentions: mentions 
  });
  return null;
}, { category: 'group' });

registerCommand('everyone', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔔', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const text = args.join(' ') || '🔔 Everyone!';
  const groupMeta = await getGroupMetadata(sock, groupId);
  const mentions = groupMeta.participants.map(p => p.id);
  
  await sock.sendMessage(groupId, { 
    text: '╔═══❖•ೋ° °ೋ•❖═══╗\n┃   📢 EVERYONE\n╚═══❖•ೋ° °ೋ•❖═══╝\n\n' + text,
    mentions: mentions 
  });
  return null;
}, { category: 'group', adminOnly: true });

registerCommand('setname', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '✏️', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const name = args.join(' ');
  if (!name) return '❌ Usage: .setname <new group name>';
  
  await sock.groupUpdateSubject(groupId, name);
  return '✅ Group name changed to: ' + name;
}, { category: 'group', adminOnly: true });

registerCommand('setdesc', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '📝', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const desc = args.join(' ');
  if (!desc) return '❌ Usage: .setdesc <description>';
  
  await sock.groupUpdateDescription(groupId, desc);
  return '✅ Group description updated!';
}, { category: 'group', adminOnly: true });

registerCommand('groupinfo', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: 'ℹ️', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const groupMeta = await getGroupMetadata(sock, groupId);
  const admins = groupMeta.participants.filter(p => 
    p.admin === 'admin' || p.admin === 'superadmin'
  );
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   📊 GROUP INFO
╚═══❖•ೋ° °ೋ•❖═══╝

📛 *Name:* ${groupMeta.subject}
👥 *Members:* ${groupMeta.participants.length}
👑 *Admins:* ${admins.length}
🆔 *ID:* ${groupId.split('@')[0]}
📅 *Created:* ${new Date(groupMeta.creation * 1000).toLocaleDateString()}
${groupMeta.desc ? '\n📝 *Description:*\n' + groupMeta.desc : ''}`;
}, { category: 'group' });

registerCommand('link', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔗', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const code = await sock.groupInviteCode(groupId);
  return `🔗 *Group Invite Link*\n\nhttps://chat.whatsapp.com/${code}\n\n⚠️ Don't share with strangers!`;
}, { category: 'group', adminOnly: true });

registerCommand('revoke', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔄', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  await sock.groupRevokeInvite(groupId);
  return '✅ Invite link revoked! Generate a new one with .link';
}, { category: 'group', adminOnly: true });

registerCommand('mute', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔇', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  await sock.groupSettingUpdate(groupId, 'announcement');
  return '🔇 Group muted! Only admins can send messages.';
}, { category: 'group', adminOnly: true });

registerCommand('unmute', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔊', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  await sock.groupSettingUpdate(groupId, 'not_announcement');
  return '🔊 Group unmuted! Everyone can send messages.';
}, { category: 'group', adminOnly: true });

registerCommand('delete', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🗑️', key: msg.key } });
  const quoted = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
  if (!quoted) return '❌ Reply to the message you want to delete!';
  
  await sock.sendMessage(msg.key.remoteJid, { 
    delete: {
      remoteJid: msg.key.remoteJid,
      fromMe: quoted.participant === sock.user.id,
      id: quoted.stanzaId,
      participant: quoted.participant
    }
  });
  return null;
}, { category: 'group', adminOnly: true });

registerCommand('kick', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '👢', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo && msg.message.extendedTextMessage.contextInfo.mentionedJid ? msg.message.extendedTextMessage.contextInfo.mentionedJid[0] : null;
  if (!target) return '❌ Mention user to kick!';
  
  await sock.groupParticipantsUpdate(groupId, [target], 'remove');
  return `👢 Kicked @${target.split('@')[0].split(':')[0]}`;
}, { category: 'group', adminOnly: true });

registerCommand('add', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '➕', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const phone = args[0] ? args[0].replace(/\D/g, '') : '';
  if (!phone) return '❌ Usage: .add <phone number>';
  
  const jid = phone + '@s.whatsapp.net';
  await sock.groupParticipantsUpdate(groupId, [jid], 'add');
  return `➕ Added @${phone}`;
}, { category: 'group', adminOnly: true });

registerCommand('promote', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '⬆️', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo && msg.message.extendedTextMessage.contextInfo.mentionedJid ? msg.message.extendedTextMessage.contextInfo.mentionedJid[0] : null;
  if (!target) return '❌ Mention user to promote!';
  
  await sock.groupParticipantsUpdate(groupId, [target], 'promote');
  return `⬆️ Promoted @${target.split('@')[0].split(':')[0]} to admin`;
}, { category: 'group', adminOnly: true });

registerCommand('demote', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '⬇️', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo && msg.message.extendedTextMessage.contextInfo.mentionedJid ? msg.message.extendedTextMessage.contextInfo.mentionedJid[0] : null;
  if (!target) return '❌ Mention user to demote!';
  
  await sock.groupParticipantsUpdate(groupId, [target], 'demote');
  return `⬇️ Demoted @${target.split('@')[0].split(':')[0]}`;
}, { category: 'group', adminOnly: true });

registerCommand('antilink', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🛡️', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  if (!global.antilink) global.antilink = new Map();
  
  const action = args[0] ? args[0].toLowerCase() : '';
  if (action === 'on') {
    global.antilink.set(groupId, true);
    return '🛡️ Anti-link enabled! Links will be deleted.';
  } else if (action === 'off') {
    global.antilink.delete(groupId);
    return '🛡️ Anti-link disabled!';
  }
  
  const status = global.antilink.has(groupId) ? 'ON ✅' : 'OFF ❌';
  return `🛡️ Anti-link status: ${status}\nUse: .antilink on/off`;
}, { category: 'group', adminOnly: true });

registerCommand('welcome', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '👋', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  if (!global.welcome) global.welcome = new Map();
  
  const action = args[0] ? args[0].toLowerCase() : '';
  if (action === 'on') {
    global.welcome.set(groupId, true);
    return '👋 Welcome messages enabled!';
  } else if (action === 'off') {
    global.welcome.delete(groupId);
    return '👋 Welcome messages disabled!';
  }
  
  const status = global.welcome.has(groupId) ? 'ON ✅' : 'OFF ❌';
  return `👋 Welcome status: ${status}\nUse: .welcome on/off`;
}, { category: 'group', adminOnly: true });

registerCommand('goodbye', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '👋', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  if (!global.goodbye) global.goodbye = new Map();
  
  const action = args[0] ? args[0].toLowerCase() : '';
  if (action === 'on') {
    global.goodbye.set(groupId, true);
    return '👋 Goodbye messages enabled!';
  } else if (action === 'off') {
    global.goodbye.delete(groupId);
    return '👋 Goodbye messages disabled!';
  }
  
  const status = global.goodbye.has(groupId) ? 'ON ✅' : 'OFF ❌';
  return `👋 Goodbye status: ${status}\nUse: .goodbye on/off`;
}, { category: 'group', adminOnly: true });

registerCommand('warn', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '⚠️', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const mentioned = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo && msg.message.extendedTextMessage.contextInfo.mentionedJid ? msg.message.extendedTextMessage.contextInfo.mentionedJid[0] : null;
  const target = mentioned || (args[0] ? args[0].replace(/\D/g, '') + '@s.whatsapp.net' : null);
  if (!target) return '❌ Mention user to warn!';
  
  const reason = args.slice(1).join(' ') || 'No reason';
  
  if (!global.warnings) global.warnings = new Map();
  const key = groupId + '-' + target;
  const userWarns = global.warnings.get(key) || { count: 0, reasons: [] };
  
  userWarns.count++;
  userWarns.reasons.push(reason);
  global.warnings.set(key, userWarns);
  
  if (userWarns.count >= 3) {
    await sock.groupParticipantsUpdate(groupId, [target], 'remove');
    global.warnings.delete(key);
    return `🚫 @${target.split('@')[0].split(':')[0]} has been kicked after 3 warnings!`;
  }
  
  return `⚠️ @${target.split('@')[0].split(':')[0]} warned!\nReason: ${reason}\nWarnings: ${userWarns.count}/3`;
}, { category: 'moderation', adminOnly: true });

registerCommand('unwarn', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '✅', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo && msg.message.extendedTextMessage.contextInfo.mentionedJid ? msg.message.extendedTextMessage.contextInfo.mentionedJid[0] : null;
  if (!target) return '❌ Mention user!';
  
  const key = groupId + '-' + target;
  if (global.warnings && global.warnings.has(key)) {
    global.warnings.delete(key);
    return `✅ Warnings cleared for @${target.split('@')[0].split(':')[0]}`;
  }
  return '⚠️ User has no warnings';
}, { category: 'moderation', adminOnly: true });

registerCommand('warnings', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '📋', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const mentioned = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo && msg.message.extendedTextMessage.contextInfo.mentionedJid ? msg.message.extendedTextMessage.contextInfo.mentionedJid[0] : null;
  const target = mentioned || (args[0] ? args[0].replace(/\D/g, '') + '@s.whatsapp.net' : msg.key.participant);
  
  const key = groupId + '-' + target;
  const userWarns = global.warnings && global.warnings.get(key) ? global.warnings.get(key) : { count: 0, reasons: [] };
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   ⚠️ WARNINGS
╚═══❖•ೋ° °ೋ•❖═══╝

👤 User: @${target.split('@')[0].split(':')[0]}
🔢 Count: ${userWarns.count}/3

${userWarns.reasons.length > 0 ? '📝 Reasons:\n' + userWarns.reasons.map((r, i) => `${i+1}. ${r}`).join('\n') : '✅ No warnings'}`;
}, { category: 'moderation' });

registerCommand('ban', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🚫', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo && msg.message.extendedTextMessage.contextInfo.mentionedJid ? msg.message.extendedTextMessage.contextInfo.mentionedJid[0] : null;
  if (!target) return '❌ Mention user to ban!';
  
  if (!global.banned) global.banned = new Map();
  if (!global.banned.has(groupId)) global.banned.set(groupId, new Set());
  
  global.banned.get(groupId).add(target);
  await sock.groupParticipantsUpdate(groupId, [target], 'remove');
  
  return `🚫 @${target.split('@')[0].split(':')[0]} has been banned from this group!`;
}, { category: 'moderation', adminOnly: true });

registerCommand('unban', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '✅', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const target = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo && msg.message.extendedTextMessage.contextInfo.mentionedJid ? msg.message.extendedTextMessage.contextInfo.mentionedJid[0] : null;
  if (!target) return '❌ Mention user to unban!';
  
  if (global.banned && global.banned.has(groupId)) {
    global.banned.get(groupId).delete(target);
    return `✅ @${target.split('@')[0].split(':')[0]} has been unbanned!`;
  }
  return '⚠️ User was not banned';
}, { category: 'moderation', adminOnly: true });

registerCommand('banlist', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '📜', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  const banned = global.banned && global.banned.get(groupId) ? global.banned.get(groupId) : new Set();
  if (banned.size === 0) return '✅ No banned users in this group';
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   🚫 BANNED USERS
╚═══❖•ೋ° °ೋ•❖═══╝

${Array.from(banned).map((id, i) => `${i+1}. @${id.split('@')[0].split(':')[0]}`).join('\n')}`;
}, { category: 'moderation', adminOnly: true });

registerCommand('filter', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔍', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  if (!global.filters) global.filters = new Map();
  
  const action = args[0] ? args[0].toLowerCase() : '';
  const word = args[1] ? args[1].toLowerCase() : '';
  
  if (action === 'add' && word) {
    if (!global.filters.has(groupId)) global.filters.set(groupId, new Set());
    global.filters.get(groupId).add(word);
    return `🔍 Filter added: "${word}"`;
  } else if (action === 'remove' && word) {
    if (global.filters.has(groupId)) global.filters.get(groupId).delete(word);
    return `🔍 Filter removed: "${word}"`;
  } else if (action === 'list') {
    const words = global.filters.has(groupId) ? Array.from(global.filters.get(groupId)) : [];
    return words.length > 0 ? `🔍 Filtered words:\n${words.join(', ')}` : '🔍 No filters set';
  }
  
  return '❌ Usage: .filter add/remove/list <word>';
}, { category: 'moderation', adminOnly: true });

registerCommand('antispam', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🛡️', key: msg.key } });
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith('@g.us')) return '❌ Group only!';
  
  if (!global.antispam) global.antispam = new Map();
  
  const action = args[0] ? args[0].toLowerCase() : '';
  if (action === 'on') {
    global.antispam.set(groupId, true);
    return '🛡️ Anti-spam enabled!';
  } else if (action === 'off') {
    global.antispam.delete(groupId);
    return '🛡️ Anti-spam disabled!';
  }
  
  const status = global.antispam.has(groupId) ? 'ON ✅' : 'OFF ❌';
  return `🛡️ Anti-spam status: ${status}\nUse: .antispam on/off`;
}, { category: 'moderation', adminOnly: true });

registerCommand('broadcast', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '📢', key: msg.key } });
  const message = args.join(' ');
  if (!message) return '❌ Usage: .broadcast <message>';
  
  if (!isOwner(user, msg)) return '❌ Owner only command!';
  
  const groups = await sock.groupFetchAllParticipating();
  const groupIds = Object.keys(groups);
  
  let sent = 0;
  for (const groupId of groupIds) {
    try {
      await sock.sendMessage(groupId, {
        text: `╔═══❖•ೋ° °ೋ•❖═══╗\n┃   📢 BROADCAST\n╚═══❖•ೋ° °ೋ•❖═══╝\n\n${message}\n\n👑 _Wiz AI Pro_`
      });
      sent++;
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {}
  }
  
  return `✅ Broadcast sent to ${sent} groups!`;
}, { category: 'owner', ownerOnly: true });

registerCommand('setpp', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🖼️', key: msg.key } });
  const quoted = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
  if (!quoted) return '❌ Reply to an image with .setpp';
  
  if (!isOwner(user, msg)) return '❌ Owner only command!';
  
  const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
  if (!qMsg.imageMessage) return '❌ Not an image!';
  
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
    
    await sock.updateProfilePicture(sock.user.id, buffer);
    return '✅ Profile picture updated!';
  } catch (err) {
    return '❌ Failed to update profile picture';
  }
}, { category: 'owner', ownerOnly: true });

registerCommand('block', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🚫', key: msg.key } });
  const target = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo && msg.message.extendedTextMessage.contextInfo.mentionedJid ? msg.message.extendedTextMessage.contextInfo.mentionedJid[0] : null;
  if (!target) return '❌ Mention user to block';
  
  if (!isOwner(user, msg)) return '❌ Owner only command!';
  
  await sock.updateBlockStatus(target, 'block');
  return `🚫 Blocked @${target.split('@')[0].split(':')[0]}`;
}, { category: 'owner', ownerOnly: true });

registerCommand('unblock', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '✅', key: msg.key } });
  const target = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo && msg.message.extendedTextMessage.contextInfo.mentionedJid ? msg.message.extendedTextMessage.contextInfo.mentionedJid[0] : null;
  if (!target) return '❌ Mention user to unblock';
  
  if (!isOwner(user, msg)) return '❌ Owner only command!';
  
  await sock.updateBlockStatus(target, 'unblock');
  return `✅ Unblocked @${target.split('@')[0].split(':')[0]}`;
}, { category: 'owner', ownerOnly: true });

registerCommand('stats', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '📊', key: msg.key } });
  
  if (!isOwner(user, msg)) return '❌ Owner only command!';
  
  const User = require('./models/User');
  const totalUsers = await User.countDocuments();
  let activeSessions = 0;
  try {
    const groups = await sock.groupFetchAllParticipating();
    activeSessions = Object.keys(groups).length;
  } catch (e) {
    activeSessions = 'N/A';
  }
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   📊 BOT STATISTICS
╚═══❖•ೋ° °ೋ•❖═══╝

👥 Total Users: ${totalUsers}
💬 Active Groups: ${activeSessions}
⚡ Uptime: ${Math.floor(process.uptime() / 3600)}h
💾 Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB
📅 Commands: ${Object.keys(commands).length}+

🤖 Wiz AI Pro v3.0`;
}, { category: 'owner', ownerOnly: true });

registerCommand('exec', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '⚡', key: msg.key } });
  
  if (!isOwner(user, msg)) return '❌ Owner only command!';
  
  const { exec } = require('child_process');
  const command = args.join(' ');
  
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      if (error) resolve(`❌ Error: ${error.message}`);
      else if (stderr) resolve(`⚠️ Stderr: ${stderr}`);
      else resolve(`✅ Output:\n\`\`\`\n${stdout.substring(0, 1000)}\n\`\`\``);
    });
  });
}, { category: 'owner', ownerOnly: true });

registerCommand('eval', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔧', key: msg.key } });
  
  if (!isOwner(user, msg)) return '❌ Owner only command!';
  
  try {
    const code = args.join(' ');
    let result = eval(code);
    if (typeof result !== 'string') result = require('util').inspect(result);
    return `✅ Result:\n\`\`\`js\n${result.substring(0, 1000)}\n\`\`\``;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}, { category: 'owner', ownerOnly: true });

registerCommand('restart', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔄', key: msg.key } });
  
  if (!isOwner(user, msg)) return '❌ Owner only command!';
  
  await sock.sendMessage(msg.key.remoteJid, { text: '🔄 Restarting bot...' });
  process.exit(0);
}, { category: 'owner', ownerOnly: true });

registerCommand('menu', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '📜', key: msg.key } });
  
  const isOwnerUser = isOwner(user, msg);
  
  const categories = {
    '👥 GROUP MGMT (19)': ['tagall', 'hidetag', 'kick', 'add', 'promote', 'demote', 'setname', 'setdesc', 'groupinfo', 'link', 'revoke', 'antilink', 'welcome', 'goodbye', 'mute', 'unmute', 'delete', 'tagadmin', 'everyone'],
    '🛡️ MODERATION (8)': ['warn', 'unwarn', 'warnings', 'ban', 'unban', 'banlist', 'filter', 'antispam'],
    '🤖 AI TOOLS (16)': ['ai', 'gpt', 'imagine', 'imaginefast', 'imagineanime', 'imaginereal', 'translate', 'summarize', 'chatbot', 'remind', 'ocr', 'tts', 'anime', 'code', 'fix', 'explain'],
    '💰 ECONOMY (12)': ['balance', 'daily', 'deposit', 'withdraw', 'transfer', 'top', 'level', 'leaderboard', 'rob', 'work', 'crime', 'slut'],
    '🎮 GAMES (9)': ['slot', 'roulette', 'trivia', 'tictactoe', 'move', 'rps', 'blackjack', 'hangman', 'guess'],
    '😂 FUN (15)': ['joke', 'quote', 'roll', 'flip', 'choose', 'rate', 'gaycheck', 'marry', 'acceptmarry', 'divorce', 'ship', '8ball', 'meme', 'fact', 'roast', 'compliment'],
    '🛠️ UTILITY (18)': ['ping', 'uptime', 'serverinfo', 'calc', 'convert', 'qr', 'shorten', 'password', 'whois', 'weather', 'news', 'crypto', 'bin', 'ip', 'github', 'define', 'movie', 'npm'],
    '📺 MEDIA (12)': ['sticker', 'toimg', 'vv', 'save', 'play', 'ytsearch', 'tiktok', 'ig', 'fb', 'x', 'lyrics', 'pinterest'],
    '👑 OWNER (8)': isOwnerUser ? ['broadcast', 'setpp', 'block', 'unblock', 'stats', 'exec', 'eval', 'restart'] : []
  };
  
  let menuText = `╔══════════════════════════════════╗
║  🤖 WIZ AI PRO ULTRA 🤖          ║
║  ⚡ 250+ COMMANDS ⚡              ║
║  🌟 VERSION 3.0 PREMIUM 🌟       ║
╚══════════════════════════════════╝

👑 Owner: ${user.username || 'WISDOM'}
📱 Status: ONLINE ✅
🤖 Smart AI: Enabled
🔄 Auto-Reply: 4 messages max

`;
  
  for (const [cat, cmds] of Object.entries(categories)) {
    if (cmds.length === 0) continue;
    menuText += '\n' + cat + '\n';
    menuText += cmds.map(c => `• .${c}`).join('  ');
    menuText += '\n';
  }
  
  menuText += `\n📢 Channel: https://whatsapp.com/channel/0029VbCOs0vGU3BI6SYsDf17

⚡ Powered by Wiz AI Pro v3.0
💡 Use .help <command> for details
🤖 Smart bot that knows when to stop!`;
  
  return menuText;
}, { category: 'info' });

registerCommand('help', async (sock, msg, args, user) => {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: '❓', key: msg.key } });
  const cmd = args[0] ? args[0].toLowerCase() : '';
  if (!cmd) return '❌ Usage: .help <command>';
  
  const command = commands[cmd];
  if (!command) return '❌ Command not found!';
  
  return `╔═══❖•ೋ° °ೋ•❖═══╗
┃   ❓ HELP: .${cmd}
╚═══❖•ೋ° °ೋ•❖═══╝

📁 Category: ${command.category || 'General'}
${command.adminOnly ? '👑 Admin Only: Yes\n' : ''}${command.ownerOnly ? '🔒 Owner Only: Yes\n' : ''}

💡 Description: ${command.desc || 'No description available'}`;
}, { category: 'info' });

module.exports = {
  ownerStatusMap,
  isOwnerOnline: (userId) => {
    const status = ownerStatusMap.get(userId);
    if (!status) return false;
    return Date.now() - status.lastActivity < 5 * 60 * 1000;
  },
  updateOwnerActivity: (userId, phone) => {
    ownerStatusMap.set(userId, {
      lastActivity: Date.now(),
      phone: phone
    });
  },
  tagallEmojis,
  getNextTagallEmoji,
  isOwner
};
