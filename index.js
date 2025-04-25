/**
 * Telegram Raid Bot - Entry Point
 * This file initializes the bot and connects all components
 */

// Load environment variables from .env file
require('dotenv').config();

// Import required packages
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { initializeCommands } = require('./src/bot/commands');
const { setupCallbackHandlers } = require('./src/bot/callbackHandlers');
const { setupMiddleware } = require('./src/bot/middleware');
const { connectToSupabase } = require('./src/services/supabaseService');
const logger = require('./src/utils/logger');

// Create Express app for webhook and Twitter OAuth callback
const app = express();
const PORT = process.env.PORT || 3000;
// Parse JSON bodies for webhook updates and OAuth2 callbacks
app.use(express.json());
// Mount Twitter OAuth2 callback handler
const twitterCallbackHandler = require('./api/twitter/callback');
app.get('/api/twitter/callback', twitterCallbackHandler);
app.post('/api/twitter/callback', twitterCallbackHandler);

// Check for required environment variables
if (!process.env.TELEGRAM_BOT_TOKEN) {
  logger.error('TELEGRAM_BOT_TOKEN is not defined in .env file');
  process.exit(1);
}

const config = require('./config/config');
// Initialize the bot without polling; we'll start polling or webhook after setup
const bot = new TelegramBot(config.telegram.token, { polling: false });

// Log bot startup
logger.info(`Bot is starting in ${config.env} mode`);

// Connect to Supabase
connectToSupabase()
  .then(() => {
    logger.info('Connected to Supabase successfully');
    
    // Setup bot middleware and commands
    setupMiddleware(bot);
    initializeCommands(bot);
    // Set up callback query handlers for inline buttons
    setupCallbackHandlers(bot);
    
    // Decide between polling and webhook based on configuration
    if (config.telegram.polling) {
      logger.info('Starting polling');
      bot.deleteWebHook()
        .then(() => bot.startPolling())
        .then(() => logger.info('Polling started'))
        .catch(err => logger.error('Failed to start polling:', err.message));
      // Start Express server to handle Twitter OAuth callback in polling mode
      app.listen(PORT, () => logger.info(`Express server is running on port ${PORT}`));
    } else {
      logger.info('Webhook mode enabled');
      // Health check endpoint
      app.get('/', (req, res) => res.send('Telegram Raid Bot is running!'));
      // Webhook setup if enabled
      if (config.server.webhookEnabled) {
        const hookUrl = `${config.server.webhookUrl}/bot${config.telegram.token}`;
        // Attempt to set the Telegram webhook
        bot.setWebHook(hookUrl)
          .then(() => logger.info(`Telegram webhook set to ${hookUrl}`))
          .catch(err => {
            // Log detailed error from Telegram API
            const errMsg = err.response?.body || err.message;
            logger.error('Failed to set Telegram webhook:', errMsg);
          });
        // Route incoming webhook updates
        app.post(`/bot${config.telegram.token}`, (req, res) => {
          // Log incoming Telegram updates for debugging
          logger.debug('Received Telegram webhook update', req.body);
          bot.processUpdate(req.body)
            .then(() => res.sendStatus(200))
            .catch(err => {
              logger.error('Error processing Telegram update:', err);
              res.sendStatus(500);
            });
        });
      } else {
        logger.warn('Webhook is not enabled. Bot will not receive updates.');
      }
      // Start Express server
      const port = config.server.port || PORT;
      app.listen(port, () => logger.info(`Express server is running on port ${port}`));
    }
  })
  .catch(err => {
    logger.error('Failed to start the bot:', err);
    process.exit(1);
  });

// Handle bot errors
bot.on('polling_error', (error) => {
  logger.error('Polling error:', error);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  // In production, you might want to restart the bot here
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // In production, you might want to restart the bot here
});

module.exports = bot; // Export the bot instance for testing