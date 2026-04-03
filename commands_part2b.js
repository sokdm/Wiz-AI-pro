const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const cheerio = require('cheerio');
const { commands, registerCommand } = require('./commands_part1');

// Helper function to download TikTok using alternative API
async function downloadTikTok(url) {
  try {
    // Method 1: Using tikwm.com API
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });
    
    if (response.data && response.data.data && response.data.data.play) {
      const videoUrl = response.data.data.play;
      const videoRes = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.tikwm.com/'
        }
      });
      return Buffer.from(videoRes.data);
    }
    
    throw new Error('No video URL in response');
  } catch (err) {
    console.log('TikWM failed:', err.message);
    
    // Method 2: Using savetik.co
    try {
      const response = await axios.post('https://savetik.co/api/ajaxSearch',
        new URLSearchParams({ q: url, lang: 'en' }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-Requested-With': 'XMLHttpRequest'
          },
          timeout: 30000
        }
      );
      
      const $ = cheerio.load(response.data.data);
      const videoUrl = $('a[href*="download"]').attr('href') || $('a[download]').attr('href');
      
      if (videoUrl) {
        const videoRes = await axios.get(videoUrl, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        return Buffer.from(videoRes.data);
      }
      
      throw new Error('No download link found');
    } catch (err2) {
      throw new Error('All TikTok download methods failed: ' + err2.message);
    }
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

// 33. VV - View Once Saver
registerCommand('vv', async (sock, msg, args, user) => {
  try {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    
    if (!contextInfo || !contextInfo.quotedMessage) {
      return '❌ Reply to a view-once message with .vv';
    }

    const quotedMessage = contextInfo.quotedMessage;
    
    const isViewOnceImage = quotedMessage.imageMessage?.viewOnce === true;
    const isViewOnceVideo = quotedMessage.videoMessage?.viewOnce === true;
    const isViewOnceAudio = quotedMessage.audioMessage?.viewOnce === true;

    if (!isViewOnceImage && !isViewOnceVideo && !isViewOnceAudio) {
      return '❌ Not a view-once message! Reply to a view-once photo/video/audio.';
    }

    const mediaMsg = quotedMessage.imageMessage || quotedMessage.videoMessage || quotedMessage.audioMessage;
    if (!mediaMsg || !mediaMsg.mediaKey) {
      return '❌ Cannot download: Media key missing or view-once expired!';
    }

    const participant = contextInfo.participant || msg.key.remoteJid;

    const messageToDownload = {
      key: {
        remoteJid: msg.key.remoteJid,
        id: contextInfo.stanzaId,
        participant: participant
      },
      message: quotedMessage
    };

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
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

// 34. Save - Media Saver with TikTok support
registerCommand('save', async (sock, msg, args, user) => {
  try {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    
    if (contextInfo && contextInfo.quotedMessage) {
      const quotedMessage = contextInfo.quotedMessage;
      const stanzaId = contextInfo.stanzaId;
      
      // Check for view-once
      const isViewOnceImage = quotedMessage.imageMessage?.viewOnce === true;
      const isViewOnceVideo = quotedMessage.videoMessage?.viewOnce === true;
      const isViewOnceAudio = quotedMessage.audioMessage?.viewOnce === true;
      
      if (isViewOnceImage || isViewOnceVideo || isViewOnceAudio) {
        const mediaMsg = quotedMessage.imageMessage || quotedMessage.videoMessage || quotedMessage.audioMessage;
        if (!mediaMsg || !mediaMsg.mediaKey) {
          return '❌ Cannot save: View-once expired!';
        }
        
        const participant = contextInfo.participant || msg.key.remoteJid;
        const messageToDownload = {
          key: {
            remoteJid: msg.key.remoteJid,
            id: stanzaId,
            participant: participant
          },
          message: quotedMessage
        };
        
        const buffer = await downloadMediaMessage(
          messageToDownload,
          'buffer',
          {},
          { logger: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {}, child: () => ({ info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {} }) } }
        );
        
        if (!buffer) return '❌ Failed to download!';
        
        if (isViewOnceImage) {
          await sock.sendMessage(msg.key.remoteJid, { image: buffer, caption: '💾 Saved!\n\nPowered by Wiz AI Pro' }, { quoted: msg });
        } else if (isViewOnceVideo) {
          await sock.sendMessage(msg.key.remoteJid, { video: buffer, caption: '💾 Saved!\n\nPowered by Wiz AI Pro' }, { quoted: msg });
        } else if (isViewOnceAudio) {
          await sock.sendMessage(msg.key.remoteJid, { audio: buffer, mimetype: mediaMsg.mimetype || 'audio/mp4', ptt: mediaMsg.ptt || false }, { quoted: msg });
        }
        return null;
      }
      
      // Check for URL
      const quotedText = quotedMessage.conversation || quotedMessage.extendedTextMessage?.text || '';
      const hasUrlInQuoted = quotedText.includes('http');
      
      if (hasUrlInQuoted) {
        const urlMatch = quotedText.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
          const url = urlMatch[0];
          
          try {
            await sock.sendMessage(msg.key.remoteJid, { text: '⬇️ Downloading...' }, { quoted: msg });
            
            let buffer;
            
            if (url.includes('tiktok.com')) {
              try {
                buffer = await downloadTikTok(url);
              } catch (tiktokErr) {
                console.log('TikTok failed, trying generic:', tiktokErr.message);
                buffer = await downloadFromUrl(url);
              }
            } else {
              buffer = await downloadFromUrl(url);
            }
            
            if (url.includes('tiktok.com') || url.includes('youtube.com') || url.includes('facebook.com')) {
              await sock.sendMessage(msg.key.remoteJid, { video: buffer, caption: '💾 Downloaded!\n\nPowered by Wiz AI Pro' }, { quoted: msg });
            } else {
              try {
                await sock.sendMessage(msg.key.remoteJid, { image: buffer, caption: '💾 Downloaded!\n\nPowered by Wiz AI Pro' }, { quoted: msg });
              } catch (e) {
                await sock.sendMessage(msg.key.remoteJid, { video: buffer, caption: '💾 Downloaded!\n\nPowered by Wiz AI Pro' }, { quoted: msg });
              }
            }
            return null;
          } catch (err) {
            return '❌ Failed: ' + err.message;
          }
        }
      }

      // Handle regular media
      const hasImage = quotedMessage.imageMessage;
      const hasVideo = quotedMessage.videoMessage;
      const hasAudio = quotedMessage.audioMessage;
      const hasDocument = quotedMessage.documentMessage;
      
      if (!hasImage && !hasVideo && !hasAudio && !hasDocument) {
        return '❌ No media found!';
      }

      const participant = contextInfo.participant || msg.key.remoteJid;
      const messageToDownload = {
        key: {
          remoteJid: msg.key.remoteJid,
          id: stanzaId,
          participant: participant
        },
        message: quotedMessage
      };

      const buffer = await downloadMediaMessage(
        messageToDownload,
        'buffer',
        {},
        { logger: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {}, child: () => ({ info: () => {}, error: () => {}, debug: () => {}, warn: () => {}, trace: () => {}, fatal: () => {} }) } }
      );

      if (!buffer) return '❌ Failed to download!';

      if (hasImage) {
        await sock.sendMessage(msg.key.remoteJid, { image: buffer, caption: '💾 Saved!\n\nPowered by Wiz AI Pro' }, { quoted: msg });
      } else if (hasVideo) {
        await sock.sendMessage(msg.key.remoteJid, { video: buffer, caption: '💾 Saved!\n\nPowered by Wiz AI Pro' }, { quoted: msg });
      } else if (hasAudio) {
        await sock.sendMessage(msg.key.remoteJid, { audio: buffer, mimetype: hasAudio.mimetype || 'audio/mp4', ptt: hasAudio.ptt || false }, { quoted: msg });
      } else if (hasDocument) {
        await sock.sendMessage(msg.key.remoteJid, { document: buffer, mimetype: hasDocument.mimetype, fileName: hasDocument.fileName || 'saved_file' }, { quoted: msg });
      }
      return null;
    }
    
    // Direct URL in args
    if (args.length > 0 && args[0].includes('http')) {
      const url = args[0];
      try {
        await sock.sendMessage(msg.key.remoteJid, { text: '⬇️ Downloading...' }, { quoted: msg });
        
        let buffer;
        if (url.includes('tiktok.com')) {
          try {
            buffer = await downloadTikTok(url);
          } catch (e) {
            buffer = await downloadFromUrl(url);
          }
        } else {
          buffer = await downloadFromUrl(url);
        }
        
        if (url.includes('tiktok.com') || url.includes('youtube.com') || url.includes('facebook.com')) {
          await sock.sendMessage(msg.key.remoteJid, { video: buffer, caption: '💾 Downloaded!\n\nPowered by Wiz AI Pro' }, { quoted: msg });
        } else {
          try {
            await sock.sendMessage(msg.key.remoteJid, { image: buffer, caption: '💾 Downloaded!\n\nPowered by Wiz AI Pro' }, { quoted: msg });
          } catch (e) {
            await sock.sendMessage(msg.key.remoteJid, { video: buffer, caption: '💾 Downloaded!\n\nPowered by Wiz AI Pro' }, { quoted: msg });
          }
        }
        return null;
      } catch (err) {
        return '❌ Failed: ' + err.message;
      }
    }

    return '❌ Reply to media/status/link or use .save <url>';
  } catch (err) {
    console.error('Save error:', err);
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

module.exports = { registerCommand };
