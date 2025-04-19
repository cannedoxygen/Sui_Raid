/**
 * Telegram Bot Commands
 * Handles all command registrations and their handlers
 */

const logger = require('../utils/logger');
const { getUserById, createUserIfNotExists, isUserAdminInGroup, linkTwitterAccount, linkSuiWallet } = require('../services/userService');
const { getSupabase } = require('../services/supabaseService');
const { generateTwitterAuthUrl, handleTwitterCallback } = require('../services/twitterService');
const { generateSuiWallet, getWalletBalance } = require('../services/suiService');

// Get the bot instance
let bot = null;

/**
 * Initialize and register all bot commands
 * @param {TelegramBot} botInstance - The Telegram bot instance
 */
const initializeCommands = (botInstance) => {
  // Store bot reference
  bot = botInstance;
  
  // Register commands with Telegram (shows in menu)
  bot.setMyCommands([
    { command: 'start', description: 'Start the bot and get an introduction' },
    { command: 'help', description: 'Get help and list of available commands' },
    { command: 'login', description: 'Connect your Twitter account' },
    { command: 'wallet', description: 'Set up or view your Sui wallet' },
    { command: 'myxp', description: 'Check your XP and rewards' },
    { command: 'leaderboard', description: 'View XP leaderboard' }
  ]);

  // User commands
  bot.onText(/\/start/, handleStartCommand);
  bot.onText(/\/help/, handleHelpCommand);
  bot.onText(/\/login/, handleLoginCommand);
  bot.onText(/\/wallet/, handleWalletCommand);
  bot.onText(/\/myxp/, handleMyXpCommand);
  bot.onText(/\/leaderboard/, handleLeaderboardCommand);
  
  // Admin commands
  bot.onText(/\/dropraid/, handleDropRaidCommand);
  bot.onText(/\/endraid/, handleEndRaidCommand);
  bot.onText(/\/setrules/, handleSetRulesCommand);
  bot.onText(/\/blacklist/, handleBlacklistCommand);
  bot.onText(/\/whitelist/, handleWhitelistCommand);
  
  logger.info('Bot commands registered successfully');
};

/**
 * Handle /start command
 * @param {Object} msg - Telegram message object
 */
const handleStartCommand = async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Create user if first time
    await createUserIfNotExists({
      telegramId: userId,
      firstName: msg.from.first_name,
      lastName: msg.from.last_name,
      username: msg.from.username,
      languageCode: msg.from.language_code,
      lastActive: new Date()
    });
    
    // Welcome message
    const welcomeMessage = 
      `👋 Welcome to the Sui Raid Bot!\n\n` +
      `This bot helps you participate in Twitter raids to earn XP and crypto rewards.\n\n` +
      `🚀 *Getting Started:*\n` +
      `1. Use /login to connect your Twitter account\n` +
      `2. Use /wallet to set up your Sui wallet for rewards\n` +
      `3. Join raids posted in groups and earn XP!\n\n` +
      `Type /help to see all available commands.`;
    
    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error in start command:', error.message);
    try {
      await bot.sendMessage(msg.chat.id, 'Sorry, there was an error. Please try again later.');
    } catch (msgError) {
      logger.error('Error sending error message:', msgError.message);
    }
  }
};

/**
 * Handle /help command
 * @param {Object} msg - Telegram message object
 */
const handleHelpCommand = async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check if user is admin for this group
    const isAdmin = await isUserAdminInGroup(userId, chatId);
    
    // Help message for regular users
    let helpMessage = 
      `🤖 *Raid Bot Commands*\n\n` +
      `*User Commands:*\n` +
      `/start - Start the bot and get an introduction\n` +
      `/help - Show this help message\n` +
      `/login - Connect your Twitter account\n` +
      `/wallet - Set up or view your Sui wallet\n` +
      `/myxp - Check your XP and rewards\n` +
      `/leaderboard - View XP leaderboard\n\n` +
      `*How Raids Work:*\n` +
      `- When a raid is posted, click "Raid Now" to participate\n` +
      `- Earn XP for likes, retweets, comments, and bookmarks\n` +
      `- The more XP you earn, the more rewards you get\n` +
      `- Make sure to connect your Twitter and Sui wallet first!`;
    
    // Add admin commands if user is admin
    if (isAdmin) {
      helpMessage += 
        `\n\n*Admin Commands:*\n` +
        `/dropraid <tweet_url> - Start a new raid\n` +
        `/endraid - End the current raid manually\n` +
        `/setrules - Configure raid rules and rewards\n` +
        `/blacklist <username> - Blacklist a user from raids\n` +
        `/whitelist <username> - Add a user to the whitelist`;
    }
    
    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error in help command:', error.message);
    try {
      await bot.sendMessage(msg.chat.id, 'Sorry, there was an error. Please try again later.');
    } catch (msgError) {
      logger.error('Error sending error message:', msgError.message);
    }
  }
};

/**
 * Handle /login command to connect Twitter
 * @param {Object} msg - Telegram message object
 */
const handleLoginCommand = async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Generate Twitter auth URL
    const authUrl = await generateTwitterAuthUrl(userId);
    
    if (!authUrl) {
      throw new Error('Failed to generate Twitter authentication URL');
    }
    
    // Login button
    const loginMessage = 
      `🔑 *Connect Your Twitter Account*\n\n` +
      `To verify your Twitter account, click the button below:`;
    
    await bot.sendMessage(chatId, loginMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🐦 Connect Twitter', url: authUrl }]
        ]
      }
    });
  } catch (error) {
    logger.error(`Error in login command: ${error.message}`);
    try {
      await bot.sendMessage(msg.chat.id, 'Sorry, there was an error connecting to Twitter. Please try again later.');
    } catch (msgError) {
      logger.error(`Error sending error message: ${msgError.message}`);
    }
  }
};

/**
 * Handle /wallet command to manage Sui wallet
 * @param {Object} msg - Telegram message object
 */
const handleWalletCommand = async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Get user info
    const user = await getUserById(userId);
    
    if (!user) {
      return bot.sendMessage(chatId, 'Please use /start to set up your account first.');
    }
    
    // Check if user already has a wallet
    if (user.sui_wallet_connected) {
      try {
        // Get wallet balance
        const balance = await getWalletBalance(user.sui_wallet_address);
        
        const walletMessage = 
          `💼 *Your Sui Wallet*\n\n` +
          `Address: \`${user.sui_wallet_address}\`\n` +
          `Balance: ${balance.sui} SUI\n\n` +
          `What would you like to do?`;
        
        await bot.sendMessage(chatId, walletMessage, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Update Wallet Address', callback_data: 'wallet_update' }],
              [{ text: '👁️ View Wallet on Explorer', url: `https://explorer.sui.io/address/${user.sui_wallet_address}` }]
            ]
          }
        });
      } catch (walletError) {
        logger.error('Error getting wallet balance:', walletError.message);
        
        // Fallback message if we can't get the balance
        const walletMessage = 
          `💼 *Your Sui Wallet*\n\n` +
          `Address: \`${user.sui_wallet_address}\`\n` +
          `Balance: Unable to fetch\n\n` +
          `What would you like to do?`;
        
        await bot.sendMessage(chatId, walletMessage, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Update Wallet Address', callback_data: 'wallet_update' }],
              [{ text: '👁️ View Wallet on Explorer', url: `https://explorer.sui.io/address/${user.sui_wallet_address}` }]
            ]
          }
        });
      }
    } else {
      // User needs to set up a wallet
      const walletSetupMessage = 
        `💼 *Set Up Your Sui Wallet*\n\n` +
        `You need a Sui wallet to receive rewards. Choose an option:`;
      
      await bot.sendMessage(chatId, walletSetupMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔗 Connect Existing Wallet', callback_data: 'wallet_connect' }],
            [{ text: '✨ Generate New Wallet', callback_data: 'wallet_generate' }]
          ]
        }
      });
    }
  } catch (error) {
    logger.error('Error in wallet command:', error.message);
    try {
      await bot.sendMessage(msg.chat.id, 'Sorry, there was an error with wallet management. Please try again later.');
    } catch (msgError) {
      logger.error('Error sending error message:', msgError.message);
    }
  }
};

/**
 * Handle /myxp command to check XP and rewards
 * @param {Object} msg - Telegram message object
 */
const handleMyXpCommand = async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Get user info
    const user = await getUserById(userId);
    
    if (!user) {
      return bot.sendMessage(chatId, 'Please use /start to set up your account first.');
    }
    
    // Get ongoing campaign if any
    const supabase = getSupabase();
    const { data: activeCampaign, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('is_active', true)
      .eq('chat_id', chatId)
      .single();
    
    // XP message
    let xpMessage = 
      `🏆 *Your XP Status*\n\n` +
      `Total XP: ${user.total_xp || 0}\n`;
    
    // Add campaign-specific XP if there's an active campaign
    if (!error && activeCampaign) {
      // Get user's XP for this campaign
      const campaignXp = await getUserXpForSource(userId, 'campaign', activeCampaign.id);
      
      xpMessage += 
        `\n*Current Campaign: ${activeCampaign.name}*\n` +
        `Campaign XP: ${campaignXp}\n` +
        `Threshold: ${activeCampaign.threshold_xp} XP\n` +
        `Progress: ${Math.min(100, Math.round((campaignXp / activeCampaign.threshold_xp) * 100))}%\n` +
        `End Date: ${new Date(activeCampaign.end_date).toLocaleDateString()}\n`;
      
      // Add reward info if above threshold
      if (campaignXp >= activeCampaign.threshold_xp) {
        const potentialReward = Math.floor(campaignXp * activeCampaign.token_per_xp);
        
        xpMessage += 
          `\n✅ *Reward Eligible!*\n` +
          `Potential Reward: ${potentialReward} ${activeCampaign.token_symbol}\n`;
          
        // Add claim button if campaign has ended
        if (new Date(activeCampaign.end_date) < new Date()) {
          await bot.sendMessage(chatId, xpMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '💰 Claim Rewards', callback_data: `claim_${activeCampaign.id}` }]
              ]
            }
          });
          return;
        }
      }
    }
    
    await bot.sendMessage(chatId, xpMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error in myxp command:', error.message);
    try {
      await bot.sendMessage(msg.chat.id, 'Sorry, there was an error fetching your XP. Please try again later.');
    } catch (msgError) {
      logger.error('Error sending error message:', msgError.message);
    }
  }
};

/**
 * Handle /leaderboard command
 * @param {Object} msg - Telegram message object
 */
const handleLeaderboardCommand = async (msg) => {
  try {
    const chatId = msg.chat.id;
    
    // Get active campaign for this chat if any
    const supabase = getSupabase();
    const { data: activeCampaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('is_active', true)
      .eq('chat_id', chatId)
      .single();
    
    // Get top 10 users by XP
    let query;
    let leaders = [];
    
    if (!campaignError && activeCampaign) {
      // Get campaign-specific leaderboard
      // This would need a join or custom query to get campaign-specific XP
      // For simplicity, we'll fetch sample data for now
      try {
        const { data, error } = await supabase
          .from('users')
          .select('telegram_id, first_name, username, total_xp')
          .order('total_xp', { ascending: false })
          .limit(10);
          
        if (!error) {
          leaders = data;
        }
      } catch (error) {
        logger.error('Error fetching campaign leaderboard:', error.message);
      }
    } else {
      // Get all-time leaderboard
      try {
        const { data, error } = await supabase
          .from('users')
          .select('telegram_id, first_name, username, total_xp')
          .order('total_xp', { ascending: false })
          .limit(10);
          
        if (!error) {
          leaders = data;
        }
      } catch (error) {
        logger.error('Error fetching all-time leaderboard:', error.message);
      }
    }
    
    // Build leaderboard message
    let leaderboardMessage = (!campaignError && activeCampaign) 
      ? `🏆 *Campaign Leaderboard: ${activeCampaign.name}*\n\n`
      : `🏆 *All-Time XP Leaderboard*\n\n`;
    
    if (leaders.length === 0) {
      leaderboardMessage += 'No data available yet.';
    } else {
      leaders.forEach((user, index) => {
        const xp = user.total_xp || 0;
        const displayName = user.username 
          ? `@${user.username}` 
          : user.first_name || `User${user.telegram_id}`;
        
        // Add medal emoji for top 3
        let prefix = `${index + 1}.`;
        if (index === 0) prefix = '🥇';
        if (index === 1) prefix = '🥈';
        if (index === 2) prefix = '🥉';
        
        leaderboardMessage += `${prefix} ${displayName}: ${xp} XP\n`;
      });
    }
    
    // Add buttons for different leaderboard views
    await bot.sendMessage(chatId, leaderboardMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Campaign', callback_data: 'leaderboard_campaign' },
            { text: 'All-Time', callback_data: 'leaderboard_alltime' }
          ]
        ]
      }
    });
  } catch (error) {
    logger.error('Error in leaderboard command:', error.message);
    try {
      await bot.sendMessage(msg.chat.id, 'Sorry, there was an error fetching the leaderboard. Please try again later.');
    } catch (msgError) {
      logger.error('Error sending error message:', msgError.message);
    }
  }
};

/**
 * Handle /dropraid command (Admin only)
 * @param {Object} msg - Telegram message object
 */
const handleDropRaidCommand = async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check if user is admin
    const isAdmin = await isUserAdminInGroup(userId, chatId);
    
    if (!isAdmin) {
      return bot.sendMessage(chatId, '⛔ This command is for admins only.');
    }
    
    // Parse command - format is /dropraid <tweet_url> [optional params]
    const commandParts = msg.text.split(' ');
    
    if (commandParts.length < 2) {
      return bot.sendMessage(chatId, '⚠️ Please provide a tweet URL: /dropraid <tweet_url>');
    }
    
    const tweetUrl = commandParts[1];
    
    // Validate tweet URL (basic check)
    if (!tweetUrl.includes('twitter.com') && !tweetUrl.includes('x.com')) {
      return bot.sendMessage(chatId, '⚠️ Invalid tweet URL. Please provide a valid Twitter/X URL.');
    }
    
    // Start raid configuration flow
    await startRaidConfiguration(chatId, userId, tweetUrl);
  } catch (error) {
    logger.error('Error in dropraid command:', error.message);
    try {
      await bot.sendMessage(msg.chat.id, 'Sorry, there was an error starting the raid. Please try again later.');
    } catch (msgError) {
      logger.error('Error sending error message:', msgError.message);
    }
  }
};

/**
 * Start the raid configuration flow
 * @param {number} chatId - Telegram chat ID
 * @param {number} userId - Admin user ID
 * @param {string} tweetUrl - Tweet URL to raid
 */
const startRaidConfiguration = async (chatId, userId, tweetUrl) => {
  try {
    // Store temporary state for this configuration
    // In a production app, use a database or in-memory store for this
    global.tempRaidConfig = global.tempRaidConfig || {};
    global.tempRaidConfig[chatId] = {
      tweetUrl,
      adminId: userId,
      stage: 'mode'
    };
    
    // Ask for raid mode
    await bot.sendMessage(chatId, 
      '🚀 *Raid Configuration*\n\n' +
      'Please choose the reward mode:',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Single Raid', callback_data: 'raid_mode_single' },
              { text: 'Campaign', callback_data: 'raid_mode_campaign' }
            ]
          ]
        }
      }
    );
  } catch (error) {
    logger.error('Error starting raid configuration:', error.message);
    throw error;
  }
};

/**
 * Handle /endraid command (Admin only)
 * @param {Object} msg - Telegram message object
 */
const handleEndRaidCommand = async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check if user is admin
    const isAdmin = await isUserAdminInGroup(userId, chatId);
    
    if (!isAdmin) {
      return bot.sendMessage(chatId, '⛔ This command is for admins only.');
    }
    
    // Get active raid for this chat
    const supabase = getSupabase();
    const { data: activeRaid, error } = await supabase
      .from('raids')
      .select('*')
      .eq('chat_id', chatId)
      .eq('is_active', true)
      .single();
    
    if (error || !activeRaid) {
      return bot.sendMessage(chatId, '⚠️ There is no active raid to end.');
    }
    
    // End the raid (implementation depends on the raidService which we haven't created yet)
    // const raidResult = await endRaid(activeRaid.id);
    
    // For now, just acknowledge
    await bot.sendMessage(chatId, 
      '🏁 *Raid Ended Manually*\n\n' +
      'The raid has been ended by an admin. Calculating results...',
      { parse_mode: 'Markdown' }
    );
    
    // In a full implementation, this would call a function to end the raid,
    // calculate rewards, etc. and then show the results
  } catch (error) {
    logger.error('Error in endraid command:', error.message);
    try {
      await bot.sendMessage(msg.chat.id, 'Sorry, there was an error ending the raid. Please try again later.');
    } catch (msgError) {
      logger.error('Error sending error message:', msgError.message);
    }
  }
};

/**
 * Placeholder for admin commands that will be implemented later
 */
const handleSetRulesCommand = async (msg) => {
  try {
    await bot.sendMessage(msg.chat.id, '⚙️ This command will be implemented in a future update.');
  } catch (error) {
    logger.error('Error in setrules command:', error.message);
  }
};

const handleBlacklistCommand = async (msg) => {
  try {
    await bot.sendMessage(msg.chat.id, '⚙️ This command will be implemented in a future update.');
  } catch (error) {
    logger.error('Error in blacklist command:', error.message);
  }
};

const handleWhitelistCommand = async (msg) => {
  try {
    await bot.sendMessage(msg.chat.id, '⚙️ This command will be implemented in a future update.');
  } catch (error) {
    logger.error('Error in whitelist command:', error.message);
  }
};

module.exports = {
  initializeCommands
};