const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const cheerio = require('cheerio');
const ytdl = require('@distube/ytdl-core');
const { pipeline } = require('stream/promises');
const { commands, registerCommand, reply } = require('./commands_part1');

// Helper function to download TikTok video using alternative API
async function downloadTikTok(url) {
  try {
    // Using ssstik.io API
    const response = await axios.post('https://ssstik.io/abc', 
      new URLSearchParams({ 
        id: url,
        locale: 'en',
        tt: Date.now() 
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://ssstik.io/'
        },
        timeout: 30000
      }
    );
    
    const $ = cheerio.load(response.data);
    let videoUrl = $('a[href*="download"]').attr('href');
    
    if (!videoUrl) {
      // Try alternative extraction
      videoUrl = $('a[download]').attr('href');
    }
    
    if (!videoUrl) {
      throw new Error('Could not find video URL in response');
    }
    
    const videoRes = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    return Buffer.from(videoRes.data);
  } catch (err) {
    console.error('TikTok download error:', err.message);
    throw new Error('TikTok download failed: ' + err.message);
  }
}

// Helper function to download from URL with proper headers
async function downloadFromUrl(url) {
  try {
    const response = await axios.get(url, { 
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.google.com/'
      },
      timeout: 30000,
      maxRedirects: 5
    });
    return Buffer.from(response.data);
  } catch (err) {
    throw new Error('Failed to download from URL: ' + err.message);
  }
}

// 21. Ping
registerCommand('ping', async (sock, msg, args, user) => {
  const start = Date.now();
  const tempMsg = await sock.sendMessage(msg.key.remoteJid, { text: 'Testing...' });
  const end = Date.now();
  await sock.sendMessage(msg.key.remoteJid, { delete: tempMsg.key });
  return `🏓 Pong! ${end - start}ms`;
}, { category: 'utility' });

// 22. Uptime
registerCommand('uptime', async (sock, msg, args, user) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  return `⏱️ Uptime: ${hours}h ${minutes}m ${seconds}s`;
}, { category: 'utility' });

// 23. Server Info
registerCommand('serverinfo', async (sock, msg, args, user) => {
  const os = require('os');
  let text = `🖥️ *Server Info*\n\n`;
  text += `*Platform:* ${os.platform()}\n`;
  text += `*Arch:* ${os.arch()}\n`;
  text += `*CPU:* ${os.cpus()[0].model}\n`;
  text += `*RAM:* ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB\n`;
  text += `*Free RAM:* ${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB\n`;
  text += `*Node:* ${process.version}`;
  return text;
}, { category: 'utility' });

// 24. Joke
registerCommand('joke', async (sock, msg, args, user) => {
  try {
    const res = await axios.get('https://official-joke-api.appspot.com/random_joke');
    return `😂 *${res.data.setup}*\n\n${res.data.punchline}`;
  } catch {
    return '❌ Could not fetch joke';
  }
}, { category: 'fun' });

// 25. Quote
registerCommand('quote', async (sock, msg, args, user) => {
  const quotes = [
    "The only way to do great work is to love what you do. - Steve Jobs",
    "Stay hungry, stay foolish. - Steve Jobs",
    "The future belongs to those who believe in the beauty of their dreams. - Eleanor Roosevelt"
  ];
  return `💭 ${quotes[Math.floor(Math.random() * quotes.length)]}`;
}, { category: 'fun' });

// 26. Roll
registerCommand('roll', async (sock, msg, args, user) => {
  return `🎲 You rolled: ${Math.floor(Math.random() * 6) + 1}`;
}, { category: 'fun' });

// 27. Flip
registerCommand('flip', async (sock, msg, args, user) => {
  return `🪙 ${Math.random() < 0.5 ? 'Heads' : 'Tails'}`;
}, { category: 'fun' });

// 28. Choose
registerCommand('choose', async (sock, msg, args, user) => {
  if (args.length < 2) return '❌ Provide 2+ options with |';
  const options = args.join(' ').split('|').map(s => s.trim());
  return `🤔 I choose: *${options[Math.floor(Math.random() * options.length)]}*`;
}, { category: 'fun' });

// 29. Rate
registerCommand('rate', async (sock, msg, args, user) => {
  const thing = args.join(' ') || 'you';
  return `⭐ I rate *${thing}* ${Math.floor(Math.random() * 10) + 1}/10`;
}, { category: 'fun' });

// 30. Gay Check
registerCommand('gaycheck', async (sock, msg, args, user) => {
  const percent = Math.floor(Math.random() * 101);
  const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const name = target ? `@${target.split('@')[0]}` : args.join(' ') || 'You';
  return `🏳️‍🌈 *Gay Check*\n${name} is ${percent}% gay`;
}, { category: 'fun' });

// 31. Sticker
registerCommand('sticker', async (sock, msg, args, user) => {
  const quoted = msg.message.extendedTextMessage?.contextInfo;
  if (!quoted) return '❌ Reply to an image/video!';
  
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
    
    if (!buffer) return '❌ Failed to download media';
    
    const tmpDir = path.join(__dirname, 'tmp');
    await fs.ensureDir(tmpDir);
    const inputPath = path.join(tmpDir, `input_${Date.now()}.mp4`);
    const outputPath = path.join(tmpDir, `sticker_${Date.now()}.webp`);
    
    await fs.writeFile(inputPath, buffer);
    
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .toFormat('webp')
        .videoFilters('fps=15,scale=512:512:flags=lanczos')
        .outputOptions(['-loop 0', '-preset default', '-an', '-vsync 0'])
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });
    
    const stickerBuffer = await fs.readFile(outputPath);
    await sock.sendMessage(msg.key.remoteJid, { 
      sticker: stickerBuffer 
    }, { quoted: msg });
    
    await fs.remove(inputPath);
    await fs.remove(outputPath);
    
    return null;
  } catch (err) {
    console.error('Sticker error:', err);
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

// 32. To Image
registerCommand('toimg', async (sock, msg, args, user) => {
  const quoted = msg.message.extendedTextMessage?.contextInfo;
  if (!quoted) return '❌ Reply to a sticker!';
  
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
    
    if (!buffer) return '❌ Failed to download sticker';
    
    await sock.sendMessage(msg.key.remoteJid, { 
      image: buffer,
      caption: '🖼️ Converted to image'
    }, { quoted: msg });
    
    return null;
  } catch (err) {
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

// 33. VV - View Once Saver (Works in DMs and Groups)
registerCommand('vv', async (sock, msg, args, user) => {
  try {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    
    if (!contextInfo || !contextInfo.quotedMessage) {
      return '❌ Reply to a view-once message with .vv';
    }

    const quotedMessage = contextInfo.quotedMessage;
    
    // Check for view-once in different possible locations
    const isViewOnceImage = quotedMessage.imageMessage?.viewOnce === true;
    const isViewOnceVideo = quotedMessage.videoMessage?.viewOnce === true;
    const isViewOnceAudio = quotedMessage.audioMessage?.viewOnce === true;

    if (!isViewOnceImage && !isViewOnceVideo && !isViewOnceAudio) {
      return '❌ Not a view-once message! Reply to a view-once photo/video/audio.';
    }

    // Check if media key exists
    const mediaMsg = quotedMessage.imageMessage || quotedMessage.videoMessage || quotedMessage.audioMessage;
    if (!mediaMsg || !mediaMsg.mediaKey) {
      return '❌ Cannot download: Media key missing or view-once expired. View-once messages can only be downloaded once!';
    }

    // Determine participant - in DMs it's the remoteJid, in groups it's the participant
    const isGroup = msg.key.remoteJid.endsWith('@g.us');
    const participant = contextInfo.participant || msg.key.remoteJid;

    // Create message object for download
    const messageToDownload = {
      key: {
        remoteJid: msg.key.remoteJid,
        id: contextInfo.stanzaId,
        participant: participant
      },
      message: quotedMessage
    };

    // Download the media
    const buffer = await downloadMediaMessage(
      messageToDownload,
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
          child: () => ({ info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {} }) 
        } 
      }
    );

    if (!buffer) {
      return '❌ Failed to download media! The view-once may have expired.';
    }

    // Send back based on type
    if (isViewOnceImage) {
      await sock.sendMessage(msg.key.remoteJid, {
        image: buffer,
        caption: '💾 View-once saved!\n\nPowered by Wiz AI Pro'
      }, { quoted: msg });
    } else if (isViewOnceVideo) {
      await sock.sendMessage(msg.key.remoteJid, {
        video: buffer,
        caption: '💾 View-once saved!\n\nPowered by Wiz AI Pro'
      }, { quoted: msg });
    } else if (isViewOnceAudio) {
      await sock.sendMessage(msg.key.remoteJid, {
        audio: buffer,
        mimetype: quotedMessage.audioMessage.mimetype || 'audio/mp4',
        ptt: quotedMessage.audioMessage.ptt || false
      }, { quoted: msg });
    }

    return null;
  } catch (err) {
    console.error('VV error:', err);
    if (err.message && err.message.includes('empty media key')) {
      return '❌ Cannot download: View-once message expired or already viewed. You need to download view-once messages BEFORE opening them!';
    }
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

// 34. Save - Media Saver (Works in DMs, Groups, Links, and Status)
registerCommand('save', async (sock, msg, args, user) => {
  try {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    
    // Check if replying to a message (media or status)
    if (contextInfo && contextInfo.quotedMessage) {
      const quotedMessage = contextInfo.quotedMessage;
      const stanzaId = contextInfo.stanzaId;
      
      // Check for media types
      const hasImage = quotedMessage.imageMessage;
      const hasVideo = quotedMessage.videoMessage;
      const hasAudio = quotedMessage.audioMessage;
      const hasDocument = quotedMessage.documentMessage;
      
      // Check for URL in the replied message text
      const quotedText = quotedMessage.conversation || quotedMessage.extendedTextMessage?.text || '';
      const hasUrlInQuoted = quotedText.includes('http') || quotedText.includes('https');

      // Handle URL in quoted message
      if (hasUrlInQuoted) {
        const urlMatch = quotedText.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
          const url = urlMatch[0];
          console.log('Found URL in quoted:', url);
          
          try {
            await sock.sendMessage(msg.key.remoteJid, { 
              text: '⬇️ Downloading...' 
            }, { quoted: msg });
            
            let buffer;
            
            // Check if it's TikTok
            if (url.includes('tiktok.com')) {
              try {
                buffer = await downloadTikTok(url);
              } catch (tiktokErr) {
                console.log('TikTok download failed, trying generic download:', tiktokErr.message);
                buffer = await downloadFromUrl(url);
              }
            } else {
              buffer = await downloadFromUrl(url);
            }
            
            // Determine if video or image based on URL
            if (url.includes('tiktok.com') || url.includes('youtube.com') || url.includes('facebook.com') || url.includes('instagram.com')) {
              await sock.sendMessage(msg.key.remoteJid, {
                video: buffer,
                caption: '💾 Downloaded!\n\nPowered by Wiz AI Pro'
              }, { quoted: msg });
            } else {
              // Try as image first, if fails send as video
              try {
                await sock.sendMessage(msg.key.remoteJid, {
                  image: buffer,
                  caption: '💾 Downloaded!\n\nPowered by Wiz AI Pro'
                }, { quoted: msg });
              } catch (e) {
                await sock.sendMessage(msg.key.remoteJid, {
                  video: buffer,
                  caption: '💾 Downloaded!\n\nPowered by Wiz AI Pro'
                }, { quoted: msg });
              }
            }
            return null;
          } catch (err) {
            console.error('Download error:', err);
            return '❌ Failed to download: ' + err.message;
          }
        }
      }

      // Handle media
      if (!hasImage && !hasVideo && !hasAudio && !hasDocument) {
        return '❌ No media or link found in replied message!';
      }

      // Determine participant
      const isGroup = msg.key.remoteJid.endsWith('@g.us');
      const participant = contextInfo.participant || msg.key.remoteJid;

      // Create message object for download
      const messageToDownload = {
        key: {
          remoteJid: msg.key.remoteJid,
          id: stanzaId,
          participant: participant
        },
        message: quotedMessage
      };

      // Download the media
      const buffer = await downloadMediaMessage(
        messageToDownload,
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
            child: () => ({ info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {} }) 
          } 
        }
      );

      if (!buffer) {
        return '❌ Failed to download media!';
      }

      // Send back based on media type
      if (hasImage) {
        await sock.sendMessage(msg.key.remoteJid, {
          image: buffer,
          caption: '💾 Saved!\n\nPowered by Wiz AI Pro'
        }, { quoted: msg });
      } else if (hasVideo) {
        await sock.sendMessage(msg.key.remoteJid, {
          video: buffer,
          caption: '💾 Saved!\n\nPowered by Wiz AI Pro'
        }, { quoted: msg });
      } else if (hasAudio) {
        await sock.sendMessage(msg.key.remoteJid, {
          audio: buffer,
          mimetype: hasAudio.mimetype || 'audio/mp4',
          ptt: hasAudio.ptt || false
        }, { quoted: msg });
      } else if (hasDocument) {
        await sock.sendMessage(msg.key.remoteJid, {
          document: buffer,
          mimetype: hasDocument.mimetype,
          fileName: hasDocument.fileName || 'saved_file'
        }, { quoted: msg });
      }

      return null;
    }
    
    // Check if direct link provided in command args
    if (args.length > 0 && (args[0].includes('http') || args[0].includes('https'))) {
      const url = args[0];
      console.log('Direct URL provided:', url);
      
      try {
        await sock.sendMessage(msg.key.remoteJid, { 
          text: '⬇️ Downloading...' 
        }, { quoted: msg });
        
        let buffer;
        
        // Check if it's TikTok
        if (url.includes('tiktok.com')) {
          try {
            buffer = await downloadTikTok(url);
          } catch (tiktokErr) {
            console.log('TikTok download failed, trying generic download:', tiktokErr.message);
            buffer = await downloadFromUrl(url);
          }
        } else {
          buffer = await downloadFromUrl(url);
        }
        
        if (url.includes('tiktok.com') || url.includes('youtube.com') || url.includes('facebook.com') || url.includes('instagram.com')) {
          await sock.sendMessage(msg.key.remoteJid, {
            video: buffer,
            caption: '💾 Downloaded!\n\nPowered by Wiz AI Pro'
          }, { quoted: msg });
        } else {
          try {
            await sock.sendMessage(msg.key.remoteJid, {
              image: buffer,
              caption: '💾 Downloaded!\n\nPowered by Wiz AI Pro'
            }, { quoted: msg });
          } catch (e) {
            await sock.sendMessage(msg.key.remoteJid, {
              video: buffer,
              caption: '💾 Downloaded!\n\nPowered by Wiz AI Pro'
            }, { quoted: msg });
          }
        }
        return null;
      } catch (err) {
        console.error('Download error:', err);
        return '❌ Failed to download: ' + err.message;
      }
    }

    return '❌ Reply to a media message, status, or provide a link with .save';
  } catch (err) {
    console.error('Save error:', err);
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

module.exports = { registerCommand };
