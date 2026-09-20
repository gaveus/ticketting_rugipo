/**
 * Vercel serverless entry point. The Express app in server/server.js is the
 * whole product (API + built client); exporting it lets Vercel host it as-is.
 *
 * Note: serverless functions cannot hold websockets open — the chat falls back
 * to fast polling automatically. For true instant push use Railway/Render
 * (see DEPLOY.md).
 */
process.env.VERCEL = process.env.VERCEL || '1';
module.exports = require('../server/server');
