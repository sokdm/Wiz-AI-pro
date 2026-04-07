const http = require('http');
const https = require('https');
const axios = require('axios');

// Store active sockets for health checks
const activeSockets = new Map();

/**
 * Start keep-alive web server for Render
 */
function startKeepAliveServer(port = process.env.PORT || 3000) {
  const server = http.createServer((req, res) => {
    // Health check endpoint for UptimeRobot/Render
    if (req.url === '/health' || req.url === '/healthz' || req.url === '/') {
      const status = {
        status: 'online',
        bot: 'Wiz AI Pro',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        activeSessions: activeSockets.size
      };
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status, null, 2));
      return;
    }
    
    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(port, () => {
    console.log(`🌐 Keep-alive server running on port ${port}`);
  });

  return server;
}

/**
 * Self-ping to prevent Render idle timeout (every 10 minutes)
 */
function startSelfPing(url) {
  if (!url) {
    console.log('⚠️ No RENDER_EXTERNAL_URL found, skipping self-ping');
    return;
  }

  // Ping every 10 minutes (Render sleeps after 15 min)
  const interval = 10 * 60 * 1000;
  
  setInterval(async () => {
    try {
      const response = await axios.get(url + '/health', { timeout: 30000 });
      console.log(`[KeepAlive] Self-ping success: ${response.status} at ${new Date().toISOString()}`);
    } catch (err) {
      console.error(`[KeepAlive] Self-ping failed: ${err.message}`);
    }
  }, interval);

  console.log(`✅ Self-ping started: ${url}/health every ${interval/60000} minutes`);
}

/**
 * Register socket for monitoring
 */
function registerSocket(userId, socket) {
  activeSockets.set(userId, {
    socket,
    connectedAt: Date.now(),
    lastPing: Date.now()
  });
}

/**
 * Unregister socket
 */
function unregisterSocket(userId) {
  activeSockets.delete(userId);
}

/**
 * Get socket status
 */
function getSocketStatus(userId) {
  return activeSockets.get(userId);
}

module.exports = {
  startKeepAliveServer,
  startSelfPing,
  registerSocket,
  unregisterSocket,
  getSocketStatus,
  activeSockets
};
