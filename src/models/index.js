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

// Create Express app for webhook (if needed in production)
const app = express();
const PORT = process.env.PORT || 3000;

// Check for required environment variables
if (!process.env.TELEGRAM_BOT_TOKEN) {
  logger.error('TELEGRAM_BOT_TOKEN is not defined in .env file');
  process.exit(1);
}

// Initialize the bot with your token
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: process.env.NODE_ENV !== 'production' // Use polling in development
});

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
    
    // Simple endpoint to check if service is running
    app.get('/', (req, res) => {
      res.send('Telegram Raid Bot is running!');
    });
    
    // If in production, setup webhook instead of polling
    if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_URL) {
      bot.setWebHook(`${process.env.WEBHOOK_URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`);
      
      app.use(express.json());
      
      app.post(`/bot${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      });
      
      logger.info(`Webhook set to ${process.env.WEBHOOK_URL}`);
    }
    
    // Start Express server if in production
    if (process.env.NODE_ENV === 'production') {
      app.listen(PORT, () => {
        logger.info(`Express server is running on port ${PORT}`);
      });
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