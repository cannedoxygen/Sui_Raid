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
    
    // Twitter OAuth callback route
    app.get('/twitter/callback', async (req, res) => {
      try {
        const { code, state } = req.query;
        if (!code || !state) {
          return res.status(400).send('Missing required parameters');
        }
        // Complete Twitter OAuth flow
        const result = await require('./src/services/twitterService').handleTwitterCallback(code, state);
        if (!result) {
          return res.status(400).send('Authentication failed');
        }
        const user = await require('./src/services/userService').getUserById(result.telegramId);
        if (!user) {
          return res.status(404).send('User not found');
        }
        // Determine bot username for redirect link
        const botUsername = process.env.BOT_USERNAME || 'your_bot';
        // Success page
        const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Twitter Account Connected</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; margin: 0; padding: 20px; background-color: #f5f8fa; color: #14171a; }
              .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 16px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
              h1 { color: #1d9bf0; margin-bottom: 20px; }
              p { margin-bottom: 30px; font-size: 16px; line-height: 1.5; }
              .button { display: inline-block; background-color: #1d9bf0; color: white; text-decoration: none; padding: 12px 24px; border-radius: 50px; font-weight: bold; transition: background-color 0.3s; }
              .button:hover { background-color: #1a8cd8; }
              .success-icon { font-size: 72px; margin-bottom: 20px; color: #4BB543; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success-icon">✓</div>
              <h1>Twitter Account Connected!</h1>
              <p>Your Twitter account @${result.twitterUser.username} has been successfully connected to your Telegram account. You can now participate in Twitter raids and earn rewards!</p>
              <a href="https://t.me/${botUsername}" class="button">Return to Bot</a>
            </div>
          </body>
        </html>
        `;
        res.send(html);
      } catch (error) {
        logger.error('Error handling Twitter callback:', error);
        res.status(500).send('Authentication failed: ' + error.message);
      }
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
    
    // Start Express server
    app.listen(PORT, () => {
      logger.info(`Express server is running on port ${PORT}`);
    });
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