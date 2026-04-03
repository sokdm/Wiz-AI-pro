const axios = require('axios');
const cheerio = require('cheerio');
const ytdl = require('@distube/ytdl-core');
const { pipeline } = require('stream/promises');
const fs = require('fs-extra');
const path = require('path');
const { commands, registerCommand } = require('./commands_part1');

// Helper function to download YouTube
async function downloadYouTube(url, type = 'audio') {
  try {
    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
    
    const format = type === 'audio' 
      ? ytdl.filterFormats(info.formats, 'audioonly')[0]
      : ytdl.filterFormats(info.formats, 'videoandaudio')[0];
    
    if (!format) throw new Error('Format not available');
    
    return {
      stream: ytdl.downloadFromInfo(info, { format: format }),
      title: title,
      thumbnail: info.videoDetails.thumbnails.pop().url,
      duration: info.videoDetails.lengthSeconds
    };
  } catch (err) {
    throw err;
  }
}

// 35. Play - YouTube Audio
registerCommand('play', async (sock, msg, args, user) => {
  if (!args.length) return '❌ Provide song name or YouTube URL!';
  
  const query = args.join(' ');
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { 
      text: '🔍 Searching...' 
    }, { quoted: msg });
    
    let videoUrl;
    let title;
    
    if (query.includes('youtube.com') || query.includes('youtu.be')) {
      videoUrl = query;
      const info = await ytdl.getBasicInfo(query);
      title = info.videoDetails.title;
    } else {
      const searchRes = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
      const $ = cheerio.load(searchRes.data);
      const videoId = $('a[href^="/watch?v="]').first().attr('href')?.split('v=')[1];
      if (!videoId) return '❌ No results found!';
      videoUrl = `https://youtube.com/watch?v=${videoId}`;
      title = $('a[href^="/watch?v="]').first().find('title').text() || query;
    }
    
    const { stream, title: videoTitle, thumbnail } = await downloadYouTube(videoUrl, 'audio');
    
    const tmpDir = path.join(__dirname, 'tmp');
    await fs.ensureDir(tmpDir);
    const filePath = path.join(tmpDir, `audio_${Date.now()}.mp3`);
    
    await pipeline(stream, fs.createWriteStream(filePath));
    
    await sock.sendMessage(msg.key.remoteJid, { 
      image: { url: thumbnail },
      caption: `🎵 *${videoTitle}*\n\n⏳ Uploading audio...`
    }, { quoted: msg });
    
    await sock.sendMessage(msg.key.remoteJid, { 
      audio: fs.readFileSync(filePath),
      mimetype: 'audio/mpeg',
      fileName: `${videoTitle}.mp3`
    }, { quoted: msg });
    
    await fs.remove(filePath);
    return null;
    
  } catch (err) {
    console.error('Play error:', err);
    return '❌ Failed to download: ' + err.message;
  }
}, { category: 'media' });

// 36. YTSearch
registerCommand('ytsearch', async (sock, msg, args, user) => {
  if (!args.length) return '❌ Provide search query!';
  
  try {
    const query = args.join(' ');
    const res = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
    const $ = cheerio.load(res.data);
    
    const videos = [];
    $('a[href^="/watch?v="]').each((i, el) => {
      if (i >= 5) return false;
      const title = $(el).find('title').text() || $(el).text();
      const videoId = $(el).attr('href').split('v=')[1];
      if (title && videoId) {
        videos.push({ title: title.trim(), url: `https://youtube.com/watch?v=${videoId}` });
      }
    });
    
    if (!videos.length) return '❌ No results found!';
    
    let text = `🔍 *YouTube Search Results for "${query}"*\n\n`;
    videos.forEach((v, i) => {
      text += `${i + 1}. ${v.title}\n${v.url}\n\n`;
    });
    
    return text;
  } catch (err) {
    return '❌ Search failed: ' + err.message;
  }
}, { category: 'media' });

// 37. TikTok Downloader
registerCommand('tiktok', async (sock, msg, args, user) => {
  if (!args.length) return '❌ Provide TikTok URL!';
  
  const url = args[0];
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { 
      text: '📱 Downloading from TikTok...' 
    }, { quoted: msg });
    
    // Using SnapTik API approach
    const apiRes = await axios.post('https://snaptik.app/abc.php', new URLSearchParams({ url }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    
    const $ = cheerio.load(apiRes.data);
    const downloadUrl = $('a[href*="download"]').attr('href') || $('video source').attr('src');
    
    if (!downloadUrl) {
      // Alternative: try ssstik.io
      const altRes = await axios.post('https://ssstik.io/abc', new URLSearchParams({ 
        id: url,
        locale: 'en' 
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0'
        }
      });
      
      const alt$ = cheerio.load(altRes.data);
      const altUrl = alt$('a[href*="download"]').attr('href');
      
      if (!altUrl) return '❌ Could not extract download link!';
      
      const videoRes = await axios.get(altUrl, { responseType: 'arraybuffer' });
      await sock.sendMessage(msg.key.remoteJid, { 
        video: Buffer.from(videoRes.data),
        caption: '📱 TikTok Video Downloaded\n\nPowered by Wiz AI Pro'
      }, { quoted: msg });
      return null;
    }
    
    const videoRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
    await sock.sendMessage(msg.key.remoteJid, { 
      video: Buffer.from(videoRes.data),
      caption: '📱 TikTok Video Downloaded\n\nPowered by Wiz AI Pro'
    }, { quoted: msg });
    return null;
    
  } catch (err) {
    console.error('TikTok error:', err);
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

// 38. Instagram Downloader
registerCommand('ig', async (sock, msg, args, user) => {
  if (!args.length) return '❌ Provide Instagram URL!';
  
  const url = args[0];
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { 
      text: '📷 Downloading from Instagram...' 
    }, { quoted: msg });
    
    // Using Instagram downloader API
    const apiRes = await axios.get(`https://saveig.app/api/ajaxSearch`, {
      params: { q: url, t: 'media' },
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    
    const $ = cheerio.load(apiRes.data.data);
    const mediaUrl = $('a[href]').attr('href');
    
    if (!mediaUrl) {
      // Alternative method
      const altRes = await axios.post('https://instadownloader.co/insta-downloader.php', 
        new URLSearchParams({ url }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      
      const alt$ = cheerio.load(altRes.data);
      const altUrl = alt$('a[href*="download"]').attr('href');
      
      if (!altUrl) return '❌ Could not extract media!';
      
      const mediaRes = await axios.get(altUrl, { responseType: 'arraybuffer' });
      await sock.sendMessage(msg.key.remoteJid, { 
        video: Buffer.from(mediaRes.data),
        caption: '📷 Instagram Video Downloaded\n\nPowered by Wiz AI Pro'
      }, { quoted: msg });
      return null;
    }
    
    const mediaRes = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
    await sock.sendMessage(msg.key.remoteJid, { 
      video: Buffer.from(mediaRes.data),
      caption: '📷 Instagram Video Downloaded\n\nPowered by Wiz AI Pro'
    }, { quoted: msg });
    return null;
    
  } catch (err) {
    console.error('Instagram error:', err);
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

// 39. Facebook Downloader
registerCommand('fb', async (sock, msg, args, user) => {
  if (!args.length) return '❌ Provide Facebook URL!';
  
  const url = args[0];
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { 
      text: '📘 Downloading from Facebook...' 
    }, { quoted: msg });
    
    // Using fbdown.net API
    const apiRes = await axios.post('https://fbdown.net/download.php', 
      new URLSearchParams({ URLz: url }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0'
        }
      }
    );
    
    const $ = cheerio.load(apiRes.data);
    const videoUrl = $('a[href*="video"]').attr('href') || $('a[download]').attr('href');
    
    if (!videoUrl) {
      // Try alternative
      const altRes = await axios.get(`https://fdown.net/download.php?url=${encodeURIComponent(url)}`);
      const alt$ = cheerio.load(altRes.data);
      const altUrl = alt$('a[href*="download"]').first().attr('href');
      
      if (!altUrl) return '❌ Could not extract video!';
      
      const videoRes = await axios.get(altUrl, { responseType: 'arraybuffer' });
      await sock.sendMessage(msg.key.remoteJid, { 
        video: Buffer.from(videoRes.data),
        caption: '📘 Facebook Video Downloaded\n\nPowered by Wiz AI Pro'
      }, { quoted: msg });
      return null;
    }
    
    const videoRes = await axios.get(videoUrl, { responseType: 'arraybuffer' });
    await sock.sendMessage(msg.key.remoteJid, { 
      video: Buffer.from(videoRes.data),
      caption: '📘 Facebook Video Downloaded\n\nPowered by Wiz AI Pro'
    }, { quoted: msg });
    return null;
    
  } catch (err) {
    console.error('Facebook error:', err);
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

// 40. X (Twitter) Downloader
registerCommand('x', async (sock, msg, args, user) => {
  if (!args.length) return '❌ Provide X/Twitter URL!';
  
  const url = args[0];
  
  try {
    await sock.sendMessage(msg.key.remoteJid, { 
      text: '🐦 Downloading from X...' 
    }, { quoted: msg });
    
    // Using ssstwitter.com API
    const apiRes = await axios.post('https://ssstwitter.com/abc', 
      new URLSearchParams({ 
        id: url,
        locale: 'en',
        tt: Date.now() 
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://ssstwitter.com/'
        }
      }
    );
    
    const $ = cheerio.load(apiRes.data);
    const videoUrl = $('a[href*="download"]').attr('href') || $('a[download]').attr('href');
    
    if (!videoUrl) {
      // Try alternative: twittervideodownloader.com
      const altRes = await axios.post('https://twittervideodownloader.com/download', 
        new URLSearchParams({ tweet: url }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      
      const alt$ = cheerio.load(altRes.data);
      const altUrl = alt$('a[href]').attr('href');
      
      if (!altUrl) return '❌ Could not extract video!';
      
      const videoRes = await axios.get(altUrl, { responseType: 'arraybuffer' });
      await sock.sendMessage(msg.key.remoteJid, { 
        video: Buffer.from(videoRes.data),
        caption: '🐦 X Video Downloaded\n\nPowered by Wiz AI Pro'
      }, { quoted: msg });
      return null;
    }
    
    const videoRes = await axios.get(videoUrl, { responseType: 'arraybuffer' });
    await sock.sendMessage(msg.key.remoteJid, { 
      video: Buffer.from(videoRes.data),
      caption: '🐦 X Video Downloaded\n\nPowered by Wiz AI Pro'
    }, { quoted: msg });
    return null;
    
  } catch (err) {
    console.error('X error:', err);
    return '❌ Failed: ' + err.message;
  }
}, { category: 'media' });

module.exports = { registerCommand };
