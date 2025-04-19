/**
 * Callback Handlers
 * Processes callback queries (button clicks) from Telegram
 */

const logger = require('../utils/logger');
const { Raid } = require('../models/raidModel');
const { Campaign } = require('../models/campaignModel');
const User = require('../models/userModel');
const raidService = require('../services/raidService');
const helpers = require('../utils/helpers');

/**
 * Set up callback query handlers
 * @param {TelegramBot} bot - Telegram bot instance
 */
const setupCallbackHandlers = (bot) => {
  bot.on('callback_query', async (query) => {
    try {
      const { id, data, message, from } = query;
      
      // Always acknowledge the callback to remove loading state
      await bot.answerCallbackQuery(id);
      
      // Parse callback data
      if (!data) return;
      
      logger.debug(`Callback query received: ${data} from user ${from.id}`);
      
      // Handle different callback types
      if (data.startsWith('verify_')) {
        await handleVerifyCallback(bot, query);
      } else if (data.startsWith('stats_')) {
        await handleStatsCallback(bot, query);
      } else if (data.startsWith('leaderboard_')) {
        await handleLeaderboardCallback(bot, query);
      } else if (data.startsWith('claim_')) {
        await handleClaimCallback(bot, query);
      } else if (data.startsWith('wallet_')) {
        await handleWalletCallback(bot, query);
      } else if (data.startsWith('raid_mode_')) {
        await handleRaidModeCallback(bot, query);
      } else if (data.startsWith('token_type_')) {
        await handleTokenTypeCallback(bot, query);
      }
      
    } catch (error) {
      logger.error('Error handling callback query:', error.message);
      
      // Notify user of error
      try {
        await bot.sendMessage(query.from.id, 
          '❌ An error occurred while processing your request. Please try again later.');
      } catch (err) {
        logger.error('Error sending error message:', err.message);
      }
    }
  });
  
  logger.info('Callback handlers set up successfully');
};

/**
 * Handle verify action callback
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {Object} query - Callback query
 */
const handleVerifyCallback = async (bot, query) => {
  const { data, from, message } = query;
  const raidId = parseInt(data.split('_')[1]);
  
  // Send "processing" message
  const processingMsg = await bot.sendMessage(from.id, 
    '⏳ Verifying your Twitter actions... Please wait.');
  
  try {
    // Verify user actions
    const verificationResult = await raidService.verifyUserActions(raidId, from.id);
    
    // Delete processing message
    await bot.deleteMessage(from.id, processingMsg.message_id);
    
    if (!verificationResult.success) {
      if (verificationResult.needsTwitter) {
        // User needs to connect Twitter first
        return await bot.sendMessage(from.id,
          '❌ *Twitter account not connected*\n\n' +
          'You need to connect your Twitter account first using /login',
          { parse_mode: 'Markdown' });
      }
      
      return await bot.sendMessage(from.id, 
        `❌ *Verification failed*\n\n${verificationResult.error}`,
        { parse_mode: 'Markdown' });
    }
    
    // Format verification results
    let message = '✅ *Actions Verified*\n\n';
    let totalXp = 0;
    
    if (verificationResult.results.actions.length === 0) {
      message += 'No Twitter actions were detected for this raid. Make sure you have engaged with the tweet.\n\n';
    } else {
      message += '*Actions detected:*\n';
      
      verificationResult.results.actions.forEach(action => {
        totalXp += action.xp;
        
        switch (action.type) {
          case 'like':
            message += `👍 Like (+${action.xp} XP)\n`;
            break;
          case 'retweet':
            message += `🔄 Retweet (+${action.xp} XP)\n`;
            break;
          case 'comment':
            let commentType = 'Comment';
            if (action.hasMedia) {
              commentType = action.isGif ? 'Comment with GIF' : 'Comment with image';
            }
            message += `💬 ${commentType} (+${action.xp} XP)\n`;
            break;
        }
      });
      
      message += `\n*Total XP earned:* ${totalXp} XP\n`;
    }
    
    // Add suggestions for undetected actions
    if (!verificationResult.results.like || !verificationResult.results.retweet) {
      message += '\n*Suggestions:*\n';
      
      if (!verificationResult.results.like) {
        message += '• Like the tweet for additional XP\n';
      }
      
      if (!verificationResult.results.retweet) {
        message += '• Retweet for additional XP\n';
      }
      
      if (!verificationResult.results.comment) {
        message += '• Add a comment for additional XP\n';
      }
    }
    
    // Send verification results
    await bot.sendMessage(from.id, message, { parse_mode: 'Markdown' });
    
    // Update raid stats in the group
    const raid = await Raid.findById(raidId);
    if (raid && raid.isActive) {
      await raidService.updateRaidStatusMessage(raidId, bot);
    }
  } catch (error) {
    // Delete processing message
    await bot.deleteMessage(from.id, processingMsg.message_id);
    
    logger.error('Error verifying actions:', error.message);
    await bot.sendMessage(from.id, 
      '❌ *Verification failed*\n\nAn error occurred while verifying your actions. Please try again later.',
      { parse_mode: 'Markdown' });
  }
};

/**
 * Handle stats callback
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {Object} query - Callback query
 */
const handleStatsCallback = async (bot, query) => {
  const { data, from, message } = query;
  const parts = data.split('_');
  
  try {
    // Check if raid or campaign stats
    if (parts[1] === 'campaign') {
      // Campaign stats
      const campaignId = parseInt(parts[2]);
      const campaign = await Campaign.findById(campaignId);
      
      if (!campaign) {
        return await bot.sendMessage(from.id, 
          '❌ Campaign not found or has been deleted.', 
          { parse_mode: 'Markdown' });
      }
      
      // Get campaign statistics
      const stats = await campaign.getStatistics();
      
      // Format message
      let messageText = `📊 *Campaign Statistics: ${campaign.name}*\n\n`;
      messageText += `🚀 *Raids:* ${stats.raidCount}\n`;
      messageText += `👥 *Participants:* ${stats.totalParticipants}\n`;
      messageText += `⭐ *Total XP:* ${stats.totalXp}\n`;
      messageText += `🏆 *Qualifying Users:* ${stats.qualifyingUsers}\n\n`;
      
      // Status info
      messageText += `*Status:* ${campaign.isActive ? '🟢 Active' : '🔴 Ended'}\n`;
      
      if (campaign.isActive) {
        messageText += `*Time remaining:* ${stats.timeRemaining}\n`;
      }
      
      // User's personal stats
      const user = await User.findByTelegramId(from.id);
      
      if (user) {
        const progress = await campaign.getUserProgress(from.id);
        
        messageText += `\n*Your Progress:*\n`;
        messageText += `XP: ${progress.xp}/${campaign.thresholdXp}\n`;
        messageText += `Progress: ${progress.percentage}%\n`;
        
        if (progress.completed) {
          messageText += `✅ *Threshold reached!*\n`;
        } else {
          messageText += `❌ *Need ${progress.remaining} more XP to reach threshold*\n`;
        }
      }
      
      // Send message
      await bot.sendMessage(from.id, messageText, { parse_mode: 'Markdown' });
    } else {
      // Raid stats
      const raidId = parseInt(parts[1]);
      
      // Get raid statistics
      const stats = await raidService.getRaidStatistics(raidId);
      
      if (!stats) {
        return await bot.sendMessage(from.id, 
          '❌ Raid not found or has been deleted.', 
          { parse_mode: 'Markdown' });
      }
      
      // Format message
      let messageText = `📊 *Raid Statistics*\n\n`;
      
      // Engagement stats
      messageText += `*Engagement:*\n`;
      messageText += `👍 ${stats.actionCounts.like} Likes\n`;
      messageText += `🔄 ${stats.actionCounts.retweet} Retweets\n`;
      messageText += `💬 ${stats.actionCounts.comment} Comments\n`;
      messageText += `📌 ${stats.actionCounts.bookmark} Bookmarks\n\n`;
      
      // Overall stats
      messageText += `👥 *Participants:* ${stats.participants}\n`;
      messageText += `⭐ *Total XP:* ${stats.totalXp}\n`;
      
      // Status info
      const statusEmoji = {
        'active': '🟢',
        'completed': '✅',
        'failed': '❌',
        'cancelled': '🛑'
      };
      
      messageText += `\n*Status:* ${statusEmoji[stats.status] || ''} ${helpers.toTitleCase(stats.status)}\n`;
      
      if (stats.isActive) {
        messageText += `*Time remaining:* ${stats.timeRemaining || 'No end time set'}\n`;
      } else {
        messageText += `*Duration:* ${Math.floor(stats.duration / 60)} minutes\n`;
      }
      
      // Target completion
      if (stats.completionPercentage < 100) {
        messageText += `*Completion:* ${stats.completionPercentage}%\n`;
        messageText += helpers.progressBar(stats.completionPercentage, 100) + '\n';
      } else {
        messageText += `*Completion:* 100% ✅\n`;
      }
      
      // Send message
      await bot.sendMessage(from.id, messageText, { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🏆 View Leaderboard', callback_data: `leaderboard_raid_${raidId}` }],
            [{ text: '🚀 Go to Tweet', url: stats.tweetUrl }]
          ]
        }
      });
    }
  } catch (error) {
    logger.error('Error handling stats callback:', error.message);
    await bot.sendMessage(from.id, 
      '❌ An error occurred while retrieving statistics. Please try again later.',
      { parse_mode: 'Markdown' });
  }
};

/**
 * Handle leaderboard callback
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {Object} query - Callback query
 */
const handleLeaderboardCallback = async (bot, query) => {
  const { data, from, message } = query;
  const parts = data.split('_');
  
  try {
    // Check if raid or campaign leaderboard
    if (parts[1] === 'raid') {
      // Raid leaderboard
      const raidId = parseInt(parts[2]);
      const raid = await Raid.findById(raidId);
      
      if (!raid) {
        return await bot.sendMessage(from.id, 
          '❌ Raid not found or has been deleted.', 
          { parse_mode: 'Markdown' });
      }
      
      // Get leaderboard
      const leaderboard = await raid.getLeaderboard(10);
      
      // Format message
      let messageText = `🏆 *Raid Leaderboard*\n\n`;
      
      if (leaderboard.length === 0) {
        messageText += 'No participants yet.';
      } else {
        leaderboard.forEach((entry, index) => {
          // Add medal emoji for top 3
          let prefix = `${index + 1}.`;
          if (index === 0) prefix = '🥇';
          if (index === 1) prefix = '🥈';
          if (index === 2) prefix = '🥉';
          
          const displayName = entry.username || entry.first_name || `User${entry.telegram_id}`;
          
          // Highlight if current user
          const isCurrentUser = entry.telegram_id === from.id;
          const userMark = isCurrentUser ? ' ← You' : '';
          
          messageText += `${prefix} ${displayName}: ${entry.total_xp} XP${userMark}\n`;
        });
        
        // Get user's rank if not in top 10
        const isUserInTop = leaderboard.some(entry => entry.telegram_id === from.id);
        
        if (!isUserInTop) {
          // Find user's XP and position
          const user = await User.findByTelegramId(from.id);
          
          if (user) {
            const userXp = await user.getXpForSource('raid', raidId);
            
            if (userXp > 0) {
              const userRank = await raid.getUserRank(from.id);
              messageText += `...\n${userRank}. ${user.getDisplayName()}: ${userXp} XP ← You\n`;
            }
          }
        }
      }
      
      // Send message
      await bot.sendMessage(from.id, messageText, { parse_mode: 'Markdown' });
    } else if (parts[1] === 'campaign') {
      // Campaign leaderboard
      const campaignId = parseInt(parts[2]);
      const campaign = await Campaign.findById(campaignId);
      
      if (!campaign) {
        return await bot.sendMessage(from.id, 
          '❌ Campaign not found or has been deleted.', 
          { parse_mode: 'Markdown' });
      }
      
      // Get leaderboard
      const leaderboard = await campaign.getLeaderboard(10);
      
      // Format message
      let messageText = `🏆 *Campaign Leaderboard: ${campaign.name}*\n\n`;
      
      if (leaderboard.length === 0) {
        messageText += 'No participants yet.';
      } else {
        // Add threshold line
        messageText += `Threshold: ${campaign.thresholdXp} XP\n\n`;
        
        leaderboard.forEach((entry, index) => {
          // Add medal emoji for top 3
          let prefix = `${index + 1}.`;
          if (index === 0) prefix = '🥇';
          if (index === 1) prefix = '🥈';
          if (index === 2) prefix = '🥉';
          
          const displayName = entry.username || entry.first_name || `User${entry.telegram_id}`;
          
          // Add checkmark if above threshold
          const thresholdMark = entry.total_xp >= campaign.thresholdXp ? ' ✅' : '';
          
          // Highlight if current user
          const isCurrentUser = entry.telegram_id === from.id;
          const userMark = isCurrentUser ? ' ← You' : '';
          
          messageText += `${prefix} ${displayName}: ${entry.total_xp} XP${thresholdMark}${userMark}\n`;
        });
        
        // Get user's rank if not in top 10
        const isUserInTop = leaderboard.some(entry => entry.telegram_id === from.id);
        
        if (!isUserInTop) {
          // Find user's XP and position
          const user = await User.findByTelegramId(from.id);
          
          if (user) {
            const userXp = await campaign.getUserXp(from.id);
            
            if (userXp > 0) {
              const thresholdMark = userXp >= campaign.thresholdXp ? ' ✅' : '';
              messageText += `...\nYour Position: ${user.getDisplayName()}: ${userXp} XP${thresholdMark}\n`;
            }
          }
        }
      }
      
      // Send message
      await bot.sendMessage(from.id, messageText, { parse_mode: 'Markdown' });
    } else {
      // All-time leaderboard
      const leaderboard = await User.getTopByXp(10);
      
      // Format message
      let messageText = `🏆 *All-time XP Leaderboard*\n\n`;
      
      if (leaderboard.length === 0) {
        messageText += 'No data available yet.';
      } else {
        leaderboard.forEach((user, index) => {
          // Add medal emoji for top 3
          let prefix = `${index + 1}.`;
          if (index === 0) prefix = '🥇';
          if (index === 1) prefix = '🥈';
          if (index === 2) prefix = '🥉';
          
          // Highlight if current user
          const isCurrentUser = user.telegramId === from.id;
          const userMark = isCurrentUser ? ' ← You' : '';
          
          messageText += `${prefix} ${user.getDisplayName()}: ${user.totalXp} XP${userMark}\n`;
        });
        
        // Get user's rank if not in top 10
        const isUserInTop = leaderboard.some(user => user.telegramId === from.id);
        
        if (!isUserInTop) {
          const user = await User.findByTelegramId(from.id);
          
          if (user && user.totalXp > 0) {
            const userRank = await user.getXpRank();
            messageText += `...\n${userRank}. ${user.getDisplayName()}: ${user.totalXp} XP ← You\n`;
          }
        }
      }
      
      // Send message
      await bot.sendMessage(from.id, messageText, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    logger.error('Error handling leaderboard callback:', error.message);
    await bot.sendMessage(from.id, 
      '❌ An error occurred while retrieving the leaderboard. Please try again later.',
      { parse_mode: 'Markdown' });
  }
};

/**
 * Handle claim callback
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {Object} query - Callback query
 */
const handleClaimCallback = async (bot, query) => {
  const { data, from, message } = query;
  const parts = data.split('_');
  
  try {
    // Check if user has connected wallet
    const user = await User.findByTelegramId(from.id);
    
    if (!user || !user.hasSuiWalletConnected()) {
      return await bot.sendMessage(from.id, 
        '❌ *Wallet Not Connected*\n\n' +
        'You need to connect a Sui wallet first to claim rewards.\n' +
        'Use the /wallet command to set up your wallet.',
        { parse_mode: 'Markdown' });
    }
    
    // Check if raid or campaign claim
    if (parts[1] === 'raid') {
      // Raid claim
      const raidId = parseInt(parts[2]);
      const raid = await Raid.findById(raidId);
      
      if (!raid) {
        return await bot.sendMessage(from.id, 
          '❌ Raid not found or has been deleted.', 
          { parse_mode: 'Markdown' });
      }
      
      // Calculate user's reward
      const reward = await raid.calculateUserReward(from.id);
      
      if (!reward.eligible) {
        return await bot.sendMessage(from.id, 
          `❌ *Not Eligible for Reward*\n\n${reward.reason}`, 
          { parse_mode: 'Markdown' });
      }
      
      // Check if raid is part of a campaign
      if (raid.campaignId) {
        return await bot.sendMessage(from.id, 
          '⚠️ This raid is part of a campaign. Rewards will be distributed at the end of the campaign.', 
          { parse_mode: 'Markdown' });
      }
      
      // Check if rewards have been distributed
      if (raid.rewardsDistributed) {
        return await bot.sendMessage(from.id, 
          '✅ Rewards for this raid have already been distributed. Please check your wallet.', 
          { parse_mode: 'Markdown' });
      }
      
      // Send processing message
      const processingMsg = await bot.sendMessage(from.id, 
        '⏳ Processing your reward claim... Please wait.');
      
      try {
        // Distribute reward
        const result = await raidService.distributeReward(raid, from.id, user.suiWalletAddress);
        
        // Delete processing message
        await bot.deleteMessage(from.id, processingMsg.message_id);
        
        if (!result.success) {
          return await bot.sendMessage(from.id, 
            `❌ *Claim Failed*\n\n${result.error}`, 
            { parse_mode: 'Markdown' });
        }
        
        // Send success message
        await bot.sendMessage(from.id, 
          `💰 *Reward Claimed!*\n\n` +
          `You have successfully claimed ${result.amount} ${raid.tokenSymbol}.\n` +
          `Transaction ID: ${result.txId.substring(0, 10)}...\n\n` +
          `The tokens have been sent to your wallet:\n` +
          `\`${helpers.maskSensitiveString(user.suiWalletAddress, 6)}\``,
          { parse_mode: 'Markdown' });
      } catch (error) {
        // Delete processing message
        await bot.deleteMessage(from.id, processingMsg.message_id);
        
        logger.error('Error claiming reward:', error.message);
        await bot.sendMessage(from.id, 
          '❌ An error occurred while processing your claim. Please try again later.',
          { parse_mode: 'Markdown' });
      }
    } else if (parts[1] === 'campaign') {
      // Campaign claim
      const campaignId = parseInt(parts[2]);
      const campaign = await Campaign.findById(campaignId);
      
      if (!campaign) {
        return await bot.sendMessage(from.id, 
          '❌ Campaign not found or has been deleted.', 
          { parse_mode: 'Markdown' });
      }
      
      // Calculate user's reward
      const reward = await campaign.calculateUserReward(from.id);
      
      if (!reward.eligible) {
        return await bot.sendMessage(from.id, 
          `❌ *Not Eligible for Reward*\n\n${reward.reason}`, 
          { parse_mode: 'Markdown' });
      }
      
      // Check if campaign is active
      if (campaign.isActive) {
        return await bot.sendMessage(from.id, 
          '⚠️ This campaign is still active. Rewards will be distributed after the campaign ends.', 
          { parse_mode: 'Markdown' });
      }
      
      // Check if rewards have been distributed
      if (campaign.rewardsDistributed) {
        return await bot.sendMessage(from.id, 
          '✅ Rewards for this campaign have already been distributed. Please check your wallet.', 
          { parse_mode: 'Markdown' });
      }
      
      // Send processing message
      const processingMsg = await bot.sendMessage(from.id, 
        '⏳ Processing your reward claim... Please wait.');
      
      try {
        // Distribute reward
        const result = await raidService.distributeCampaignReward(campaign, from.id, user.suiWalletAddress);
        
        // Delete processing message
        await bot.deleteMessage(from.id, processingMsg.message_id);
        
        if (!result.success) {
          return await bot.sendMessage(from.id, 
            `❌ *Claim Failed*\n\n${result.error}`, 
            { parse_mode: 'Markdown' });
        }
        
        // Send success message
        await bot.sendMessage(from.id, 
          `💰 *Reward Claimed!*\n\n` +
          `You have successfully claimed ${result.amount} ${campaign.tokenSymbol}.\n` +
          `Transaction ID: ${result.txId.substring(0, 10)}...\n\n` +
          `The tokens have been sent to your wallet:\n` +
          `\`${helpers.maskSensitiveString(user.suiWalletAddress, 6)}\``,
          { parse_mode: 'Markdown' });
      } catch (error) {
        // Delete processing message
        await bot.deleteMessage(from.id, processingMsg.message_id);
        
        logger.error('Error claiming campaign reward:', error.message);
        await bot.sendMessage(from.id, 
          '❌ An error occurred while processing your claim. Please try again later.',
          { parse_mode: 'Markdown' });
      }
    }
  } catch (error) {
    logger.error('Error handling claim callback:', error.message);
    await bot.sendMessage(from.id, 
      '❌ An error occurred while processing your claim. Please try again later.',
      { parse_mode: 'Markdown' });
  }
};

/**
 * Handle wallet callback
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {Object} query - Callback query
 */
const handleWalletCallback = async (bot, query) => {
  const { data, from, message } = query;
  const action = data.split('_')[1];
  
  try {
    // Get user
    const user = await User.findByTelegramId(from.id);
    
    if (!user) {
      return await bot.sendMessage(from.id, 
        '❌ User not found. Please use /start to set up your account.',
        { parse_mode: 'Markdown' });
    }
    
    if (action === 'connect') {
      // Ask for wallet address
      await bot.sendMessage(from.id, 
        '💼 *Connect Existing Wallet*\n\n' +
        'Please send your Sui wallet address.',
        { parse_mode: 'Markdown' });
      
      // Set user state to wait for wallet address
      // This requires state management which we'll need to handle in commands.js
      // For now we'll just show how to handle the input
    } else if (action === 'generate') {
      // Send processing message
      const processingMsg = await bot.sendMessage(from.id, 
        '⏳ Generating a new Sui wallet... Please wait.');
      
      try {
        // Generate new wallet
        const { suiService } = require('../services/suiService');
        const wallet = await suiService.generateSuiWallet();
        
        // Connect wallet to user
        await user.connectSuiWallet(wallet.address, true);
        
        // Delete processing message
        await bot.deleteMessage(from.id, processingMsg.message_id);
        
        // Send success message with warning to save private key
        await bot.sendMessage(from.id, 
          `💼 *New Wallet Generated!*\n\n` +
          `Address: \`${wallet.address}\`\n\n` +
          `🔑 *IMPORTANT: Save your private key securely!*\n` +
          `Private Key: \`${wallet.privateKey}\`\n\n` +
          `⚠️ This is the only time you'll see this private key. It gives full access to your wallet. Save it securely and never share it with anyone!`,
          { parse_mode: 'Markdown' });
      } catch (error) {
        // Delete processing message
        await bot.deleteMessage(from.id, processingMsg.message_id);
        
        logger.error('Error generating wallet:', error.message);
        await bot.sendMessage(from.id, 
          '❌ An error occurred while generating your wallet. Please try again later.',
          { parse_mode: 'Markdown' });
      }
    } else if (action === 'update') {
      // Ask for new wallet address
      await bot.sendMessage(from.id, 
        '💼 *Update Wallet Address*\n\n' +
        'Please send your new Sui wallet address.',
        { parse_mode: 'Markdown' });
      
      // Set user state to wait for new wallet address
      // This requires state management which we'll handle in commands.js
    }
  } catch (error) {
    logger.error('Error handling wallet callback:', error.message);
    await bot.sendMessage(from.id, 
      '❌ An error occurred. Please try again later.',
      { parse_mode: 'Markdown' });
  }
};

/**
 * Handle raid mode callback
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {Object} query - Callback query
 */
const handleRaidModeCallback = async (bot, query) => {
  const { data, from, message } = query;
  const mode = data.split('_')[2]; // single or campaign
  
  try {
    // Get temporary raid configuration
    if (!global.tempRaidConfig || !global.tempRaidConfig[message.chat.id]) {
      return await bot.sendMessage(from.id, 
        '❌ Raid configuration not found. Please start again with /dropraid.',
        { parse_mode: 'Markdown' });
    }
    
    const raidConfig = global.tempRaidConfig[message.chat.id];
    
    // Check if user is the admin who initiated the configuration
    if (raidConfig.adminId !== from.id) {
      return await bot.answerCallbackQuery(query.id, {
        text: 'Only the admin who started this configuration can set options.',
        show_alert: true
      });
    }
    
    // Update raid mode
    raidConfig.mode = mode;
    raidConfig.stage = 'token';
    
    // Ask for token type
    let messageText = '🪙 *Choose Token Type for Rewards*\n\n';
    
    if (mode === 'single') {
      messageText += 'Select the token type for this single raid:';
    } else {
      messageText += 'Select the token type for this campaign:';
    }
    
    // Edit message to show token options
    await bot.editMessageText(messageText, {
      chat_id: message.chat.id,
      message_id: message.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'SUI', callback_data: 'token_type_sui' },
            { text: 'Custom Token', callback_data: 'token_type_custom' }
          ]
        ]
      }
    });
  } catch (error) {
    logger.error('Error handling raid mode callback:', error.message);
    await bot.sendMessage(from.id, 
      '❌ An error occurred. Please try again later.',
      { parse_mode: 'Markdown' });
  }
};

/**
 * Handle token type callback
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {Object} query - Callback query
 */
const handleTokenTypeCallback = async (bot, query) => {
  const { data, from, message } = query;
  const tokenType = data.split('_')[2]; // sui or custom
  
  try {
    // Get temporary raid configuration
    if (!global.tempRaidConfig || !global.tempRaidConfig[message.chat.id]) {
      return await bot.sendMessage(from.id, 
        '❌ Raid configuration not found. Please start again with /dropraid.',
        { parse_mode: 'Markdown' });
    }
    
    const raidConfig = global.tempRaidConfig[message.chat.id];
    
    // Check if user is the admin who initiated the configuration
    if (raidConfig.adminId !== from.id) {
      return await bot.answerCallbackQuery(query.id, {
        text: 'Only the admin who started this configuration can set options.',
        show_alert: true
      });
    }
    
    // Update token type
    if (tokenType === 'sui') {
      raidConfig.tokenType = '0x2::sui::SUI';
      raidConfig.tokenSymbol = 'SUI';
      raidConfig.stage = 'reward_model';
      
      // Ask for reward model
      let messageText = '💰 *Choose Reward Model*\n\n';
      messageText += 'Select how rewards will be distributed:';
      
      // Edit message to show reward model options
      await bot.editMessageText(messageText, {
        chat_id: message.chat.id,
        message_id: message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Fixed per XP', callback_data: 'reward_model_fixed' },
              { text: 'Pool Share', callback_data: 'reward_model_pool' }
            ]
          ]
        }
      });
    } else {
      // Ask for custom token details
      raidConfig.stage = 'custom_token';
      
      // Send message to get custom token details
      await bot.editMessageText(
        '🪙 *Custom Token Details*\n\n' +
        'Please provide the token information in the format:\n' +
        '`token_type token_symbol`\n\n' +
        'Example: `0x123456::mycoin::MYCOIN MYCOIN`\n\n' +
        '*Note:* The token type must be a valid Sui token address.',
        {
          chat_id: message.chat.id,
          message_id: message.message_id,
          parse_mode: 'Markdown'
        }
      );
      
      // Now we need to wait for text input, which should be handled in commands.js
      // For custom token handling
    }
  } catch (error) {
    logger.error('Error handling token type callback:', error.message);
    await bot.sendMessage(from.id, 
      '❌ An error occurred. Please try again later.',
      { parse_mode: 'Markdown' });
  }
};

module.exports = {
  setupCallbackHandlers
};