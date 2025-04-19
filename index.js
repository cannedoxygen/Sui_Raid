/**
 * Bot Initialization
 * Sets up the Telegram bot and connects components
 */

const TelegramBot = require('node-telegram-bot-api');
const logger = require('./src/utils/logger');
const { setupMiddleware } = require('./src/bot/middleware');
const { initializeCommands } = require('./src/bot/commands');
const { setupScheduledTasks } = require('.src/bot/services/raidService');
const config = require('../../config/config');

let bot = null;

/**
 * Initialize the Telegram bot
 * @returns {TelegramBot} Initialized bot instance
 */
const initializeBot = () => {
  if (bot) {
    return bot; // Return existing instance if already initialized
  }
  
  try {
    const token = config.telegram.token;
    
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env file');
    }
    
    // Create bot instance
    const options = {
      polling: config.telegram.polling
    };
    
    // Create new bot
    bot = new TelegramBot(token, options);
    
    logger.info(`Bot is starting in ${config.env} mode`);
    
    // Set up middleware for processing messages
    setupMiddleware(bot);
    
    // Register all bot commands
    initializeCommands(bot);
    
    // Set up scheduled tasks
    setupScheduledTasks(bot);
    
    // Set up webhook if in production
    if (config.isProduction && config.telegram.webhookEnabled) {
      const webhookUrl = `${config.server.webhookUrl}${config.telegram.webhookPath}`;
      
      bot.setWebHook(webhookUrl)
        .then(() => {
          logger.info(`Webhook set to ${webhookUrl}`);
        })
        .catch((error) => {
          logger.error('Error setting webhook:', error.message);
        });
    }
    
    // Global error handler for bot
    bot.on('polling_error', (error) => {
      logger.error('Polling error:', error);
    });
    
    // Log successful initialization
    logger.info('Bot successfully initialized');
    
    return bot;
  } catch (error) {
    logger.error('Failed to initialize bot:', error);
    throw error;
  }
};

/**
 * Get the bot instance
 * @returns {TelegramBot} Bot instance
 */
const getBot = () => {
  if (!bot) {
    throw new Error('Bot not initialized. Call initializeBot() first.');
  }
  
  return bot;
};

/**
 * Handle webhook update from Express server
 * @param {Object} update - Telegram update object
 * @returns {Promise<void>}
 */
const handleWebhookUpdate = async (update) => {
  try {
    if (!bot) {
      throw new Error('Bot not initialized. Call initializeBot() first.');
    }
    
    await bot.processUpdate(update);
  } catch (error) {
    logger.error('Error processing webhook update:', error.message);
    throw error;
  }
};

module.exports = {
  initializeBot,
  getBot,
  handleWebhookUpdate
};