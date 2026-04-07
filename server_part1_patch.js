// ADD THESE LINES AT THE TOP OF server_part1.js AFTER EXISTING REQUIRES:

const { startKeepAliveServer, startSelfPing, registerSocket, unregisterSocket } = require('./keepalive');

// Start keep-alive server immediately
const keepAliveServer = startKeepAliveServer();

// Start self-ping if on Render
if (process.env.RENDER_EXTERNAL_URL) {
  startSelfPing(process.env.RENDER_EXTERNAL_URL);
}

// Export for use in other parts
module.exports.keepAlive = { registerSocket, unregisterSocket };
