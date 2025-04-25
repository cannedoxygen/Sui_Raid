/**
 * Telegram Webhook Handler
 * This serverless function processes Telegram updates via webhook
 */
// Load environment variables
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const config = require('../config/config');
const logger = require('../src/utils/logger');
const { connectToSupabase } = require('../src/services/supabaseService');
const { setupMiddleware } = require('../src/bot/middleware');
const { initializeCommands } = require('../src/bot/commands');
const { setupCallbackHandlers } = require('../src/bot/callbackHandlers');

// Instantiate bot in webhook (no polling) mode
const bot = new TelegramBot(config.telegram.token, { polling: false });

/**
 * Handler for Telegram webhook endpoint
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      // Connect to database
      await connectToSupabase();
      // Ensure bot middleware and commands are initialized
      setupMiddleware(bot);
      initializeCommands(bot);
      setupCallbackHandlers(bot);
      // Process the incoming update
      await bot.processUpdate(req.body);
      return res.status(200).send('OK');
    } catch (error) {
      logger.error('Error processing Telegram webhook:', error);
      return res.status(500).send('Error processing update');
    }
  }
  // Respond to GET for health checks
  res.status(200).send('Telegram webhook endpoint');
};