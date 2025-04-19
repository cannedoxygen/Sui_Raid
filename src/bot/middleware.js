/**
 * Telegram Bot Middleware
 * Handles message processing and user tracking
 */

const logger = require('../utils/logger');
const { getSupabase } = require('../services/supabaseService');
const { getUserById, createUserIfNotExists } = require('../services/userService');

/**
 * Set up all middleware for the bot
 * @param {TelegramBot} bot - The Telegram bot instance
 */
const setupMiddleware = (bot) => {
  // Log all incoming messages
  bot.on('message', logIncomingMessage);
  
  // Track users and sessions
  bot.on('message', trackUserActivity);
  
  // Process message analytics
  bot.on('message', processMessageAnalytics);
  
  // Handle callback queries (button clicks)
  bot.on('callback_query', handleCallbackQuery);
  
  logger.info('Bot middleware configured successfully');
};

/**
 * Log basic info about incoming messages
 * @param {Object} msg - Telegram message object
 */
const logIncomingMessage = async (msg) => {
  const { id: chatId, type: chatType } = msg.chat;
  const { id: userId, username } = msg.from || {};
  
  logger.debug(
    `Message received - Chat: ${chatId} (${chatType}), ` +
    `User: ${userId} ${username ? '(@' + username + ')' : ''}`
  );
};

/**
 * Track user activity and create user records if needed
 * @param {Object} msg - Telegram message object
 */
const trackUserActivity = async (msg) => {
  try {
    const { id: userId, first_name, last_name, username, language_code } = msg.from || {};
    
    if (!userId) return;
    
    // Create or update user in database
    await createUserIfNotExists({
      telegramId: userId,
      firstName: first_name,
      lastName: last_name,
      username: username,
      languageCode: language_code,
      lastActive: new Date()
    });

  } catch (error) {
    logger.error('Error tracking user activity:', error.message);
  }
};

/**
 * Process message analytics for reporting
 * @param {Object} msg - Telegram message object
 */
const processMessageAnalytics = async (msg) => {
  try {
    const supabase = getSupabase();
    const { id: msgId, chat, from, date } = msg;
    
    // Skip processing for non-user messages (service messages, etc.)
    if (!from) return;
    
    // Record basic analytics (message count by user, chat, etc.)
    const { error } = await supabase
      .from('analytics')
      .insert({
        message_id: msgId,
        chat_id: chat.id,
        chat_type: chat.type,
        user_id: from.id,
        timestamp: new Date(date * 1000).toISOString(),
        message_type: getMessageType(msg)
      });
      
    if (error) {
      logger.warn('Failed to record analytics:', error.message);
    }
  } catch (error) {
    logger.error('Error processing message analytics:', error.message);
  }
};

/**
 * Handle callback queries (button clicks)
 * @param {Object} query - Telegram callback query object
 */
const handleCallbackQuery = async (query) => {
  try {
    const { id, from, message, data } = query;
    
    logger.debug(
      `Callback query received - From: ${from.id} (@${from.username || 'none'}), ` +
      `Data: ${data}`
    );
    
    // Always acknowledge the callback query to remove loading state
    await bot.answerCallbackQuery(id);
    
    // The actual handling will be done in command handlers
  } catch (error) {
    logger.error('Error handling callback query:', error.message);
  }
};

/**
 * Determine the type of message received
 * @param {Object} msg - Telegram message object
 * @returns {string} The message type
 */
const getMessageType = (msg) => {
  if (msg.text) return 'text';
  if (msg.photo) return 'photo';
  if (msg.video) return 'video';
  if (msg.document) return 'document';
  if (msg.sticker) return 'sticker';
  if (msg.voice) return 'voice';
  if (msg.audio) return 'audio';
  if (msg.animation) return 'animation';
  if (msg.location) return 'location';
  if (msg.contact) return 'contact';
  if (msg.poll) return 'poll';
  if (msg.new_chat_members) return 'new_chat_members';
  if (msg.left_chat_member) return 'left_chat_member';
  return 'other';
};

module.exports = {
  setupMiddleware
};