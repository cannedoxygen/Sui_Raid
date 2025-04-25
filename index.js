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
const { setupMiddleware } = require('./src/bot/middleware');
const { connectToSupabase } = require('./src/services/supabaseService');
const logger = require('./src/utils/logger');

// Environment check function
function checkEnvironment() {
  const requiredVars = [
    'TELEGRAM_BOT_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_KEY'
  ];
  
  // Only required in production
  if (process.env.NODE_ENV === 'production') {
    requiredVars.push('WEBHOOK_URL');
  }
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  
  // Log important config (but hide sensitive values)
  logger.info(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Bot username: ${process.env.BOT_USERNAME || 'unknown'}`);
  if (process.env.WEBHOOK_URL) {
    logger.info(`WEBHOOK_URL configured: ${process.env.WEBHOOK_URL}`);
  } else {
    logger.info('Running in polling mode (no WEBHOOK_URL)');
  }
  
  // Validate URL format for webhook
  if (process.env.WEBHOOK_URL && !process.env.WEBHOOK_URL.startsWith('https://')) {
    logger.error('WEBHOOK_URL must start with https://');
    process.exit(1);
  }
}

// Run environment check
checkEnvironment();

// Create Express app for webhook (if needed in production)
const app = express();
const PORT = process.env.PORT || 3000;

// Check for required environment variables
if (!process.env.TELEGRAM_BOT_TOKEN) {
  logger.error('TELEGRAM_BOT_TOKEN is not defined in .env file');
  process.exit(1);
}

// Initialize the bot with your token
let bot;
try {
  // Initialize the bot with your token and options
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    polling: process.env.NODE_ENV !== 'production', // Use polling in development
    filepath: false, // Don't download files to disk
    onlyFirstMatch: false // Process all matching command handlers, not just the first
  });
  
  // Set up basic error handler
  bot.on('polling_error', (error) => {
    logger.error(`Polling error: ${error.message}`);
  });
  
  logger.info(`Bot initialized in ${process.env.NODE_ENV || 'development'} mode using ${process.env.NODE_ENV !== 'production' ? 'polling' : 'webhooks'}`);
} catch (error) {
  logger.error(`Failed to initialize bot: ${error.message}`);
  process.exit(1);
}

// Log bot startup
logger.info(`Bot is starting in ${process.env.NODE_ENV || 'development'} mode`);

// Connect to Supabase
connectToSupabase()
  .then(() => {
    logger.info('Connected to Supabase successfully');
    
    // Setup bot middleware for processing messages
    setupMiddleware(bot);
    
    // Register all bot commands
    initializeCommands(bot);
    
    // Only boot HTTP routes & listener in production
    if (process.env.NODE_ENV === 'production') {
      // Health check
      app.get('/', (req, res) => res.send('Telegram Raid Bot is running!'));
      
      // Twitter OAuth callback
      app.get('/twitter/callback', require('./src/services/twitterService').expressCallback);
      
      // Webhook setup if configured
      if (process.env.WEBHOOK_URL) {
        const webhookPath = `/bot${process.env.TELEGRAM_BOT_TOKEN}`;
        const webhookUrl = `${process.env.WEBHOOK_URL}${webhookPath}`;
        
        // First, delete any existing webhook
        bot.deleteWebHook()
          .then(() => {
            // Then set the new webhook with proper options
            return bot.setWebHook(webhookUrl, {
              max_connections: 40,
              allowed_updates: ["message", "callback_query"]
            });
          })
          .then(() => {
            logger.info(`Webhook set to ${webhookUrl}`);
            
            // Configure Express for webhook handling
            app.use(express.json());
            app.post(webhookPath, (req, res) => {
              if (req.body) {
                logger.debug(`Webhook received update: ${JSON.stringify(req.body).substring(0, 100)}...`);
                bot.processUpdate(req.body);
                res.sendStatus(200);
              } else {
                logger.warn('Received empty webhook body');
                res.sendStatus(400);
              }
            });
          })
          .catch(error => {
            logger.error(`Failed to set webhook: ${error.message}`);
          });
      }
      
      // Start Express server
      app.listen(PORT, () => logger.info(`Express server is running on port ${PORT}`));
    }
  })
  .catch(err => {
    logger.error('Failed to start the bot:', err);
    process.exit(1);
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