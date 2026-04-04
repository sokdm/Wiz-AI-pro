const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const { pipeline } = require('stream/promises');

const TEMP_DIR = path.join(__dirname, 'temp');

// Cookie jar for YouTube (helps avoid blocks)
const COOKIE_JAR = {
  'x-youtube-client-name': '1',
  'x-youtube-client-version': '2.20240404.00.00',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
};

registerCommand('playvn', async (sock, msg, args, user) => {
  const query = args.join(' ');
  if (!query) return '❌ Usage: .playvn <song name>\nExample: .playvn Burna Boy Last Last';

  const tempFiles = [];
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { 
      text: `🔍 Searching YouTube for "${query}"...` 
    }, { quoted: msg });

    // Use yt-search for better reliability
    const searchResults = await yts(query + ' audio');
    
    if (!searchResults.videos || searchResults.videos.length === 0) {
      return '❌ No results found on YouTube.\n\nTry:\n• Different keywords\n• Artist name + song name\n• Check spelling';
    }

    const video = searchResults.videos[0];
    const videoUrl = video.url;
    const title = video.title.substring(0, 60);
    
    console.log(`[PlayVN] Found: ${title} (${videoUrl})`);

    await sock.sendMessage(msg.key.remoteJid, { 
      text: `🎵 Found: *${title}*\n⏱️ Duration: ${video.timestamp}\n\nDownloading... (30-60s)` 
    }, { quoted: msg });

    // Try multiple formats
    let audioStream;
    let formatFound = false;
    
    try {
      // Get info with cookies to avoid bot detection
      const info = await ytdl.getInfo(videoUrl, {
        requestOptions: {
          headers: COOKIE_JAR
        }
      });

      // Find best audio format
      const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
      
      if (audioFormats.length === 0) {
        throw new Error('No audio formats available');
      }

      // Sort by quality
      audioFormats.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
      const bestFormat = audioFormats[0];
      
      console.log(`[PlayVN] Using format: ${bestFormat.itag} (${bestFormat.audioBitrate}kbps)`);
      
      audioStream = ytdl.downloadFromInfo(info, {
        format: bestFormat,
        requestOptions: {
          headers: COOKIE_JAR
        }
      });
      
      formatFound = true;
    } catch (formatErr) {
      console.error('[PlayVN] Format error:', formatErr.message);
      
      // Fallback: try direct download
      try {
        audioStream = ytdl(videoUrl, {
          quality: 'highestaudio',
          filter: 'audioonly',
          requestOptions: {
            headers: COOKIE_JAR
          }
        });
        formatFound = true;
      } catch (fallbackErr) {
        throw new Error('YouTube is blocking downloads. Try again later.');
      }
    }

    if (!formatFound) {
      throw new Error('Could not find playable format');
    }

    // Download to temp file
    const tempFile = path.join(TEMP_DIR, `${Date.now()}_raw.mp4`);
    tempFiles.push(tempFile);
    
    await sock.sendMessage(msg.key.remoteJid, { 
      text: '⬇️ Downloading audio stream...' 
    }, { quoted: msg });

    await pipeline(audioStream, fs.createWriteStream(tempFile));

    // Verify download
    const stats = await fs.stat(tempFile);
    if (stats.size < 50000) {
      throw new Error('Downloaded file too small (possibly blocked)');
    }

    console.log(`[PlayVN] Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);

    // Convert to voice note
    const vnFile = path.join(TEMP_DIR, `${Date.now()}_vn.ogg`);
    tempFiles.push(vnFile);
    
    await sock.sendMessage(msg.key.remoteJid, { 
      text: '🔊 Converting to WhatsApp voice note...' 
    }, { quoted: msg });

    await new Promise((resolve, reject) => {
      ffmpeg(tempFile)
        .toFormat('opus')
        .audioBitrate(64)
        .audioChannels(1)
        .audioFrequency(24000)
        .on('start', (cmd) => console.log('[FFmpeg] Started:', cmd))
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`[FFmpeg] Processing: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', () => {
          console.log('[FFmpeg] Finished');
          resolve();
        })
        .on('error', (err) => {
          console.error('[FFmpeg] Error:', err.message);
          reject(new Error('Audio conversion failed: ' + err.message));
        })
        .save(vnFile);
    });

    // Verify conversion
    const vnStats = await fs.stat(vnFile);
    if (vnStats.size < 10000) {
      throw new Error('Converted file too small');
    }

    // Send as voice note
    const audioBuffer = await fs.readFile(vnFile);
    
    console.log(`[PlayVN] Sending voice note: ${(vnStats.size / 1024).toFixed(2)}KB`);

    await sock.sendMessage(msg.key.remoteJid, {
      audio: audioBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
      fileName: `${title.replace(/[^a-z0-9]/gi, '_')}.ogg`
    }, { quoted: msg });

    // Cleanup
    for (const file of tempFiles) {
      try { await fs.remove(file); } catch (e) {}
    }

    return null;

  } catch (err) {
    console.error('[PlayVN] Error:', err);
    
    // Cleanup on error
    for (const file of tempFiles) {
      try { await fs.remove(file); } catch {}
    }
    
    // Specific error messages
    if (err.message.includes('copyright') || err.message.includes('restricted')) {
      return '❌ This song is blocked by YouTube due to copyright.\n\nTry:\n• Different song\n• Live performance version\n• Cover version';
    }
    
    if (err.message.includes('blocking') || err.message.includes('bot')) {
      return '❌ YouTube is temporarily blocking downloads.\n\nSolutions:\n• Wait 5-10 minutes and try again\n• Try a less popular song\n• Use .spotify to get streaming link instead';
    }
    
    if (err.message.includes('no video id')) {
      return '❌ Could not find that song on YouTube.\n\nTry:\n• Different spelling\n• Artist name + song name\n• Shorter search terms';
    }
    
    if (err.message.includes('ffmpeg')) {
      return '❌ Audio conversion failed.\n\nMake sure ffmpeg is installed:\npkg install ffmpeg';
    }
    
    return `❌ Failed: ${err.message}\n\nTry again later or use different keywords.`;
  }
}, { category: 'media' });

// Also add a simpler alternative command using different method
registerCommand('song', async (sock, msg, args, user) => {
  const query = args.join(' ');
  if (!query) return '❌ Usage: .song <name>\nAlternative to .playvn';

  try {
    await sock.sendMessage(msg.key.remoteJid, { 
      text: `🔍 Searching for "${query}"...` 
    }, { quoted: msg });

    const searchResults = await yts(query);
    
    if (!searchResults.videos || searchResults.videos.length === 0) {
      return '❌ No results';
    }

    const video = searchResults.videos[0];
    
    // Try using youtube-dl-exec as alternative
    const youtubedl = require('youtube-dl-exec');
    
    await sock.sendMessage(msg.key.remoteJid, { 
      text: '🎵 Downloading with alternative method...' 
    }, { quoted: msg });

    const output = path.join(TEMP_DIR, `${Date.now()}.mp3`);
    
    await youtubedl(video.url, {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 0,
      output: output
    });

    const audio = await fs.readFile(output);
    
    await sock.sendMessage(msg.key.remoteJid, {
      audio: audio,
      mimetype: 'audio/mpeg',
      fileName: `${video.title}.mp3`
    }, { quoted: msg });

    await fs.remove(output);
    return null;

  } catch (err) {
    return `❌ Alternative method also failed: ${err.message}\n\nTry .spotify instead for streaming links.`;
  }
}, { category: 'media' });
