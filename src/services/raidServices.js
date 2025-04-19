/**
 * Raid Service
 * Handles business logic for raid creation, management, and reward distribution
 */

const logger = require('../utils/logger');
const { getSupabase } = require('./supabaseService');
const { Raid, RaidStatus } = require('../models/raidModel');
const { Campaign, CampaignStatus } = require('../models/campaignModel');
const User = require('../models/userModel');
const twitterService = require('./twitterService');
const suiService = require('./suiService');
const config = require('../../config/config');
const helpers = require('../utils/helpers');

/**
 * Create a new raid
 * @param {Object} raidData - Raid configuration data
 * @param {TelegramBot} bot - Telegram bot instance for notifications
 * @returns {Object} Created raid and initial message
 */
const createRaid = async (raidData, bot) => {
  try {
    // Extract tweet ID from URL if not already provided
    if (!raidData.tweetId && raidData.tweetUrl) {
      const tweetId = twitterService.extractTweetId(raidData.tweetUrl);
      if (!tweetId) {
        throw new Error('Invalid tweet URL');
      }
      raidData.tweetId = tweetId;
    }
    
    // Fetch tweet info to validate and get details
    const tweetInfo = await twitterService.getTweetInfo(raidData.tweetUrl);
    
    if (!tweetInfo) {
      throw new Error('Failed to fetch tweet information');
    }
    
    // Create a new Raid instance
    const raid = new Raid({
      tweetId: raidData.tweetId,
      tweetUrl: raidData.tweetUrl,
      adminId: raidData.adminId,
      chatId: raidData.chatId,
      startTime: new Date(),
      isActive: true,
      targetLikes: raidData.targetLikes || 0,
      targetRetweets: raidData.targetRetweets || 0,
      targetComments: raidData.targetComments || 0,
      tokenType: raidData.tokenType || null,
      tokenSymbol: raidData.tokenSymbol || null,
      totalReward: raidData.totalReward || null,
      tokenPerXp: raidData.tokenPerXp || null,
      thresholdXp: raidData.thresholdXp || 0,
      campaignId: raidData.campaignId || null,
      duration: raidData.duration || 3600, // Default 1 hour
      requireVerification: raidData.requireVerification !== undefined ? raidData.requireVerification : true,
      description: raidData.description || ''
    });
    
    // Save the raid to get an ID
    const savedRaid = await raid.save();
    
    // Send raid announcement to chat
    const message = await sendRaidAnnouncement(savedRaid, tweetInfo, bot);
    
    // Update raid with message ID for later reference
    savedRaid.messageId = message.message_id;
    await savedRaid.save();
    
    // Schedule raid completion
    if (savedRaid.duration) {
      const endTime = new Date(savedRaid.startTime);
      endTime.setSeconds(endTime.getSeconds() + savedRaid.duration);
      savedRaid.endTime = endTime;
      await savedRaid.save();
      
      // Schedule end of raid
      scheduleRaidEnd(savedRaid.id, bot, savedRaid.duration * 1000);
    }
    
    return {
      raid: savedRaid,
      message
    };
  } catch (error) {
    logger.error('Error creating raid:', error.message);
    throw new Error(`Failed to create raid: ${error.message}`);
  }
};

/**
 * Send raid announcement message
 * @param {Raid} raid - Raid instance
 * @param {Object} tweetInfo - Tweet information
 * @param {TelegramBot} bot - Telegram bot instance
 * @returns {Object} Sent message
 */
const sendRaidAnnouncement = async (raid, tweetInfo, bot) => {
  try {
    // Prepare raid announcement message
    const messageText = formatRaidAnnouncement(raid, tweetInfo);
    
    // Prepare inline keyboard for raid actions
    const keyboard = [
      [{ text: '🚀 Raid Now', url: raid.tweetUrl }]
    ];
    
    // Add additional buttons for verified users
    if (raid.requireVerification) {
      keyboard.push([
        { text: '🔄 Verify Actions', callback_data: `verify_${raid.id}` }
      ]);
    }
    
    // Add raid info button
    keyboard.push([
      { text: '📊 Raid Stats', callback_data: `stats_${raid.id}` },
      { text: '🏆 Leaderboard', callback_data: `leaderboard_raid_${raid.id}` }
    ]);
    
    // Send message with inline keyboard
    const message = await bot.sendMessage(raid.chatId, messageText, {
      parse_mode: 'Markdown',
      disable_web_page_preview: false, // Show tweet preview
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
    
    // Lock chat if configured
    if (raid.lockChat) {
      await bot.restrictChatMember(raid.chatId, 'all_members', {
        can_send_messages: false,
        until_date: Math.floor(new Date(raid.endTime).getTime() / 1000)
      });
    }
    
    return message;
  } catch (error) {
    logger.error('Error sending raid announcement:', error.message);
    throw new Error('Failed to send raid announcement');
  }
};

/**
 * Format raid announcement message
 * @param {Raid} raid - Raid instance
 * @param {Object} tweetInfo - Tweet information
 * @returns {string} Formatted message
 */
const formatRaidAnnouncement = (raid, tweetInfo) => {
  // Format header with emoji and raid info
  let message = `🚀 *RAID ALERT!* 🚀\n\n`;
  
  // Add tweet author and content preview
  message += `*Tweet by @${tweetInfo.author?.username || 'Unknown'}*\n\n`;
  message += `${helpers.truncateText(tweetInfo.text, 200)}\n\n`;
  
  // Add actions and XP values
  message += `*Actions and XP Rewards:*\n`;
  message += `👍 Like: ${config.xp.actions.like} XP\n`;
  message += `🔄 Retweet: ${config.xp.actions.retweet} XP\n`;
  message += `💬 Comment: ${config.xp.actions.comment} XP\n`;
  message += `📸 Comment with image: ${config.xp.actions.commentWithImage} XP\n`;
  message += `📌 Bookmark: ${config.xp.actions.bookmark} XP\n\n`;
  
  // Add targets if set
  const hasTargets = raid.targetLikes > 0 || raid.targetRetweets > 0 || raid.targetComments > 0;
  
  if (hasTargets) {
    message += `*Targets:*\n`;
    if (raid.targetLikes > 0) message += `👍 ${raid.targetLikes} Likes\n`;
    if (raid.targetRetweets > 0) message += `🔄 ${raid.targetRetweets} Retweets\n`;
    if (raid.targetComments > 0) message += `💬 ${raid.targetComments} Comments\n\n`;
  }
  
  // Add reward information
  if (raid.totalReward && raid.tokenSymbol) {
    message += `*Reward Pool:* ${raid.totalReward} ${raid.tokenSymbol}\n`;
    
    if (raid.tokenPerXp) {
      message += `*Rate:* ${raid.tokenPerXp} ${raid.tokenSymbol} per XP\n`;
    } else {
      message += `*Distribution:* Proportional to XP earned\n`;
    }
    
    if (raid.thresholdXp > 0) {
      message += `*Minimum Threshold:* ${raid.thresholdXp} XP required\n`;
    }
  }
  
  // Add time information
  if (raid.endTime) {
    message += `\n⏱ *Ends:* ${helpers.formatDate(raid.endTime)}\n`;
  }
  
  if (raid.duration) {
    const hours = Math.floor(raid.duration / 3600);
    const minutes = Math.floor((raid.duration % 3600) / 60);
    
    if (hours > 0) {
      message += `⏳ *Duration:* ${hours} hour${hours !== 1 ? 's' : ''}`;
      if (minutes > 0) message += ` ${minutes} minute${minutes !== 1 ? 's' : ''}`;
      message += `\n`;
    } else if (minutes > 0) {
      message += `⏳ *Duration:* ${minutes} minute${minutes !== 1 ? 's' : ''}\n`;
    }
  }
  
  // Add verification requirement
  if (raid.requireVerification) {
    message += `\n⚠️ *Verification required* - Connect your Twitter account and verify your actions to earn full XP\n`;
  }
  
  // Add custom description if provided
  if (raid.description) {
    message += `\n${raid.description}\n`;
  }
  
  // Add call to action
  message += `\nClick "Raid Now" to participate! 👇`;
  
  return message;
};

/**
 * Schedule automatic raid end
 * @param {number} raidId - Raid ID
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {number} duration - Duration in milliseconds
 */
const scheduleRaidEnd = (raidId, bot, duration) => {
  setTimeout(async () => {
    try {
      // Get the raid
      const raid = await Raid.findById(raidId);
      
      // Skip if raid doesn't exist or is already ended
      if (!raid || !raid.isActive) {
        return;
      }
      
      // End the raid
      await endRaid(raid, bot);
    } catch (error) {
      logger.error(`Error in scheduled raid end for raid ${raidId}:`, error.message);
    }
  }, duration);
};

/**
 * End a raid
 * @param {Raid} raid - Raid instance
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {Object} options - Additional options
 * @returns {Object} Updated raid and results
 */
const endRaid = async (raid, bot, options = {}) => {
  try {
    // Update raid status
    const endedRaid = await raid.end({
      cancelled: options.cancelled || false
    });
    
    // Get final statistics
    await endedRaid.updateStatistics();
    
    // Calculate rewards if applicable
    let rewards = [];
    
    if (endedRaid.status === RaidStatus.COMPLETED && 
        (endedRaid.totalReward || endedRaid.tokenPerXp) && 
        !endedRaid.rewardsDistributed) {
      rewards = await endedRaid.calculateAllRewards();
    }
    
    // Send raid completion message
    const completionMessage = await sendRaidCompletionMessage(endedRaid, rewards, bot);
    
    // Distribute rewards if applicable and not part of a campaign
    if (rewards.length > 0 && !endedRaid.campaignId) {
      await distributeRewards(rewards, endedRaid, bot);
    }
    
    // Unlock chat if it was locked
    if (raid.lockChat) {
      await bot.restrictChatMember(raid.chatId, 'all_members', {
        can_send_messages: true
      });
    }
    
    return {
      raid: endedRaid,
      rewards,
      completionMessage
    };
  } catch (error) {
    logger.error('Error ending raid:', error.message);
    throw new Error(`Failed to end raid: ${error.message}`);
  }
};

/**
 * Send raid completion message
 * @param {Raid} raid - Raid instance
 * @param {Array} rewards - Calculated rewards
 * @param {TelegramBot} bot - Telegram bot instance
 * @returns {Object} Sent message
 */
const sendRaidCompletionMessage = async (raid, rewards, bot) => {
  try {
    // Format completion message
    let message = `🏁 *Raid Completed!*\n\n`;
    
    // Add statistics
    message += `*Final Results:*\n`;
    message += `👍 ${raid.actualLikes} Likes\n`;
    message += `🔄 ${raid.actualRetweets} Retweets\n`;
    message += `💬 ${raid.actualComments} Comments\n\n`;
    
    // Add target completion info
    const hasTargets = raid.targetLikes > 0 || raid.targetRetweets > 0 || raid.targetComments > 0;
    
    if (hasTargets) {
      const targetMet = raid.isTargetMet();
      message += targetMet ? 
        `✅ *All targets met successfully!*\n\n` : 
        `❌ *Some targets were not met*\n\n`;
    }
    
    // Add top contributors
    const leaderboard = await raid.getLeaderboard(3);
    
    if (leaderboard.length > 0) {
      message += `*Top Contributors:*\n`;
      
      leaderboard.forEach((entry, index) => {
        let prefix = `${index + 1}.`;
        if (index === 0) prefix = '🥇';
        if (index === 1) prefix = '🥈';
        if (index === 2) prefix = '🥉';
        
        message += `${prefix} ${entry.username || entry.first_name || `User${entry.telegram_id}`}: ${entry.total_xp} XP\n`;
      });
      
      message += '\n';
    }
    
    // Add reward information
    if (rewards.length > 0) {
      const totalTokens = rewards.reduce((sum, reward) => sum + parseFloat(reward.tokenAmount), 0);
      
      message += `*Rewards:*\n`;
      message += `Total: ${totalTokens.toFixed(2)} ${raid.tokenSymbol}\n`;
      message += `Recipients: ${rewards.length}\n`;
      
      if (raid.campaignId) {
        message += `\nThis raid is part of a campaign. Rewards will be distributed at the end of the campaign.\n`;
      } else {
        message += `\nRewards are being distributed now.\n`;
      }
    }
    
    // Add buttons for more details
    const keyboard = [
      [
        { text: '📊 Full Stats', callback_data: `stats_${raid.id}` },
        { text: '🏆 Leaderboard', callback_data: `leaderboard_raid_${raid.id}` }
      ]
    ];
    
    // If rewards are available, add a claim button
    if (rewards.length > 0 && !raid.campaignId) {
      keyboard.push([
        { text: '💰 Claim Rewards', callback_data: `claim_raid_${raid.id}` }
      ]);
    }
    
    // Send message with inline keyboard
    return await bot.sendMessage(raid.chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (error) {
    logger.error('Error sending raid completion message:', error.message);
    throw new Error('Failed to send raid completion message');
  }
};

/**
 * Distribute rewards to users
 * @param {Array} rewards - Calculated rewards
 * @param {Raid} raid - Raid instance
 * @param {TelegramBot} bot - Telegram bot instance
 * @returns {Object} Distribution results
 */
const distributeRewards = async (rewards, raid, bot) => {
  try {
    // Use SUI service to distribute rewards
    const results = await suiService.distributeRewards(rewards);
    
    // Update raid to mark rewards as distributed
    raid.rewardsDistributed = true;
    await raid.save();
    
    // Notify users about their rewards
    for (const reward of results.successful) {
      try {
        await bot.sendMessage(reward.telegramId, 
          `💰 *Reward Received!*\n\n` +
          `You've received ${reward.amount} ${raid.tokenSymbol} for your participation in the raid.\n\n` +
          `Transaction: ${reward.txId.substring(0, 10)}...\n\n` +
          `Thank you for your engagement!`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        logger.warn(`Failed to notify user ${reward.telegramId} about reward:`, err.message);
      }
    }
    
    return results;
  } catch (error) {
    logger.error('Error distributing rewards:', error.message);
    throw new Error(`Failed to distribute rewards: ${error.message}`);
  }
};

/**
 * Record a user action for a raid
 * @param {number} raidId - Raid ID
 * @param {number} telegramId - User's Telegram ID
 * @param {string} actionType - Action type (like, retweet, comment, bookmark)
 * @param {Object} actionData - Additional action data
 * @returns {Object} Result of the action recording
 */
const recordUserAction = async (raidId, telegramId, actionType, actionData = {}) => {
  try {
    // Get the raid
    const raid = await Raid.findById(raidId);
    
    if (!raid) {
      return { success: false, error: 'Raid not found' };
    }
    
    if (!raid.isActive) {
      return { success: false, error: 'Raid is no longer active' };
    }
    
    // Get the user
    const user = await User.findByTelegramId(telegramId);
    
    if (!user) {
      return { success: false, error: 'User not found' };
    }
    
    // Check eligibility if verification is required
    if (raid.requireVerification && !user.isVerified) {
      return { 
        success: false, 
        error: 'You need to verify your account by connecting your Twitter account',
        needsVerification: true
      };
    }
    
    // Record the action
    const result = await raid.recordUserAction(telegramId, actionType, actionData);
    
    if (result.success) {
      // Update raid statistics
      await raid.updateStatistics();
    }
    
    return result;
  } catch (error) {
    logger.error('Error recording user action:', error.message);
    return { success: false, error: 'Failed to record action' };
  }
};

/**
 * Verify user actions for a raid
 * @param {number} raidId - Raid ID
 * @param {number} telegramId - User's Telegram ID
 * @returns {Object} Verification results
 */
const verifyUserActions = async (raidId, telegramId) => {
  try {
    // Get the raid
    const raid = await Raid.findById(raidId);
    
    if (!raid) {
      return { success: false, error: 'Raid not found' };
    }
    
    // Get the user
    const user = await User.findByTelegramId(telegramId);
    
    if (!user) {
      return { success: false, error: 'User not found' };
    }
    
    if (!user.hasTwitterConnected()) {
      return { 
        success: false, 
        error: 'You need to connect your Twitter account to verify actions',
        needsTwitter: true
      };
    }
    
    // Get user's actions from Twitter
    const hasLiked = await twitterService.hasUserLikedTweet(telegramId, raid.tweetId);
    const hasRetweeted = await twitterService.hasUserRetweetedTweet(telegramId, raid.tweetId);
    const replies = await twitterService.getUserRepliesToTweet(telegramId, raid.tweetId);
    
    // Record verified actions
    const results = {
      like: null,
      retweet: null,
      comment: null,
      actions: []
    };
    
    // Record like if verified
    if (hasLiked) {
      results.like = await recordUserAction(raidId, telegramId, 'like', { verified: true });
      if (results.like.success) {
        results.actions.push({
          type: 'like',
          xp: results.like.xpEarned,
          verified: true
        });
      }
    }
    
    // Record retweet if verified
    if (hasRetweeted) {
      results.retweet = await recordUserAction(raidId, telegramId, 'retweet', { verified: true });
      if (results.retweet.success) {
        results.actions.push({
          type: 'retweet',
          xp: results.retweet.xpEarned,
          verified: true
        });
      }
    }
    
    // Record comment if verified
    if (replies.length > 0) {
      const reply = replies[0]; // Take the first reply
      
      const commentData = {
        verified: true,
        commentText: reply.text,
        hasMedia: reply.attachments && reply.attachments.media_keys && reply.attachments.media_keys.length > 0,
        isGif: reply.attachments && reply.attachments.media_keys && 
               reply.attachments.media_keys.some(key => reply.includes.media.find(m => m.media_key === key && m.type === 'animated_gif')),
        twitterActionId: reply.id
      };
      
      results.comment = await recordUserAction(raidId, telegramId, 'comment', commentData);
      
      if (results.comment.success) {
        results.actions.push({
          type: 'comment',
          xp: results.comment.xpEarned,
          verified: true,
          hasMedia: commentData.hasMedia,
          isGif: commentData.isGif
        });
      }
    }
    
    return {
      success: true,
      results
    };
  } catch (error) {
    logger.error('Error verifying user actions:', error.message);
    return { success: false, error: 'Failed to verify actions' };
  }
};

/**
 * Update raid status message
 * @param {number} raidId - Raid ID
 * @param {TelegramBot} bot - Telegram bot instance
 * @returns {Object} Updated message
 */
const updateRaidStatusMessage = async (raidId, bot) => {
  try {
    // Get the raid
    const raid = await Raid.findById(raidId);
    
    if (!raid || !raid.messageId) {
      throw new Error('Raid or message ID not found');
    }
    
    // Get tweet info
    const tweetInfo = await twitterService.getTweetInfo(raid.tweetUrl);
    
    // Update the message text
    const messageText = formatRaidStatusUpdate(raid, tweetInfo);
    
    // Prepare inline keyboard for raid actions
    const keyboard = [
      [{ text: '🚀 Raid Now', url: raid.tweetUrl }]
    ];
    
    // Add additional buttons for verified users
    if (raid.requireVerification) {
      keyboard.push([
        { text: '🔄 Verify Actions', callback_data: `verify_${raid.id}` }
      ]);
    }
    
    // Add raid info button
    keyboard.push([
      { text: '📊 Raid Stats', callback_data: `stats_${raid.id}` },
      { text: '🏆 Leaderboard', callback_data: `leaderboard_raid_${raid.id}` }
    ]);
    
    // Update the message
    return await bot.editMessageText(messageText, {
      chat_id: raid.chatId,
      message_id: raid.messageId,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (error) {
    logger.error('Error updating raid status message:', error.message);
    throw new Error('Failed to update raid status message');
  }
};

/**
 * Format raid status update message
 * @param {Raid} raid - Raid instance
 * @param {Object} tweetInfo - Tweet information
 * @returns {string} Formatted message
 */
const formatRaidStatusUpdate = (raid, tweetInfo) => {
  // Format header with emoji and raid info
  let message = `🚀 *RAID ALERT!* 🚀\n\n`;
  
  // Add tweet author and content preview
  message += `*Tweet by @${tweetInfo.author?.username || 'Unknown'}*\n\n`;
  message += `${helpers.truncateText(tweetInfo.text, 200)}\n\n`;
  
  // Add current progress
  message += `*Current Progress:*\n`;
  message += `👍 ${raid.actualLikes}${raid.targetLikes > 0 ? `/${raid.targetLikes}` : ''} Likes\n`;
  message += `🔄 ${raid.actualRetweets}${raid.targetRetweets > 0 ? `/${raid.targetRetweets}` : ''} Retweets\n`;
  message += `💬 ${raid.actualComments}${raid.targetComments > 0 ? `/${raid.targetComments}` : ''} Comments\n\n`;
  
  // Add progress bar if targets exist
  const hasTargets = raid.targetLikes > 0 || raid.targetRetweets > 0 || raid.targetComments > 0;
  
  if (hasTargets) {
    const completionPercentage = raid.getCompletionPercentage();
    message += `${helpers.progressBar(completionPercentage, 100)}\n\n`;
  }
  
  // Add actions and XP values
  message += `*Actions and XP Rewards:*\n`;
  message += `👍 Like: ${config.xp.actions.like} XP\n`;
  message += `🔄 Retweet: ${config.xp.actions.retweet} XP\n`;
  message += `💬 Comment: ${config.xp.actions.comment} XP\n`;
  message += `📸 Comment with image: ${config.xp.actions.commentWithImage} XP\n`;
  message += `📌 Bookmark: ${config.xp.actions.bookmark} XP\n\n`;
  
  // Add reward information
  if (raid.totalReward && raid.tokenSymbol) {
    message += `*Reward Pool:* ${raid.totalReward} ${raid.tokenSymbol}\n`;
    
    if (raid.tokenPerXp) {
      message += `*Rate:* ${raid.tokenPerXp} ${raid.tokenSymbol} per XP\n`;
    } else {
      message += `*Distribution:* Proportional to XP earned\n`;
    }
    
    if (raid.thresholdXp > 0) {
      message += `*Minimum Threshold:* ${raid.thresholdXp} XP required\n`;
    }
  }
  
  // Add time information
  if (raid.endTime) {
    if (new Date() < new Date(raid.endTime)) {
      message += `\n⏱ *Time Remaining:* ${helpers.timeUntil(raid.endTime)}\n`;
    } else {
      message += `\n⏱ *Ended:* ${helpers.formatDate(raid.endTime)}\n`;
    }
  }
  
  // Add verification requirement
  if (raid.requireVerification) {
    message += `\n⚠️ *Verification required* - Connect your Twitter account and verify your actions to earn full XP\n`;
  }
  
  // Add custom description if provided
  if (raid.description) {
    message += `\n${raid.description}\n`;
  }
  
  // Add call to action
  message += `\nClick "Raid Now" to participate! 👇`;
  
  return message;
};

/**
 * Get raid statistics
 * @param {number} raidId - Raid ID
 * @returns {Object} Raid statistics
 */
const getRaidStatistics = async (raidId) => {
  try {
    // Get the raid
    const raid = await Raid.findById(raidId);
    
    if (!raid) {
      throw new Error('Raid not found');
    }
    
    // Get user actions
    const actions = await raid.getUserActions();
    
    // Count unique participants
    const uniqueParticipants = new Set();
    
    for (const action of actions) {
      uniqueParticipants.add(action.user_id);
    }
    
    // Count action types
    const actionCounts = {
      like: actions.filter(a => a.action_type === 'like').length,
      retweet: actions.filter(a => a.action_type === 'retweet').length,
      comment: actions.filter(a => a.action_type === 'comment').length,
      bookmark: actions.filter(a => a.action_type === 'bookmark').length
    };
    
    // Get total XP
    const totalXp = await raid.getTotalXp();
    
    // Get completion percentage
    const completionPercentage = raid.getCompletionPercentage();
    
    // Calculate time data
    const startTime = new Date(raid.startTime);
    const endTime = raid.endTime ? new Date(raid.endTime) : null;
    const duration = endTime ? (endTime - startTime) / 1000 : raid.duration;
    
    let timeRemaining = null;
    if (raid.isActive && endTime) {
      timeRemaining = helpers.timeUntil(endTime);
    }
    
    // Return statistics
    return {
      id: raid.id,
      tweetUrl: raid.tweetUrl,
      startTime: raid.startTime,
      endTime: raid.endTime,
      isActive: raid.isActive,
      status: raid.status,
      participants: uniqueParticipants.size,
      actionCounts,
      totalXp,
      completionPercentage,
      duration,
      timeRemaining,
      targetMet: raid.isTargetMet()
    };
  } catch (error) {
    logger.error('Error getting raid statistics:', error.message);
    throw new Error('Failed to get raid statistics');
  }
};

/**
 * Create a campaign
 * @param {Object} campaignData - Campaign configuration data
 * @returns {Campaign} Created campaign
 */
const createCampaign = async (campaignData) => {
  try {
    // Create a new Campaign instance
    const campaign = new Campaign({
      name: campaignData.name,
      adminId: campaignData.adminId,
      chatId: campaignData.chatId,
      startDate: new Date(),
      endDate: campaignData.endDate,
      isActive: true,
      tokenType: campaignData.tokenType || null,
      tokenSymbol: campaignData.tokenSymbol || null,
      totalBudget: campaignData.totalBudget || null,
      tokenPerXp: campaignData.tokenPerXp || null,
      thresholdXp: campaignData.thresholdXp || config.xp.defaultThreshold,
      description: campaignData.description || ''
    });
    
    // Save the campaign
    return await campaign.save();
  } catch (error) {
    logger.error('Error creating campaign:', error.message);
    throw new Error(`Failed to create campaign: ${error.message}`);
  }
};

/**
 * End a campaign and distribute rewards
 * @param {number} campaignId - Campaign ID
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {Object} options - Additional options
 * @returns {Object} Campaign completion results
 */
const endCampaign = async (campaignId, bot, options = {}) => {
  try {
    // Get the campaign
    const campaign = await Campaign.findById(campaignId);
    
    if (!campaign) {
      throw new Error('Campaign not found');
    }
    
    // End the campaign
    const endedCampaign = await campaign.end({
      cancelled: options.cancelled || false
    });
    
    // Calculate rewards if applicable
    let rewards = [];
    
    if (endedCampaign.status === CampaignStatus.COMPLETED && 
        (endedCampaign.totalBudget || endedCampaign.tokenPerXp) && 
        !endedCampaign.rewardsDistributed) {
      rewards = await endedCampaign.calculateAllRewards();
    }
    
    // Send campaign completion message
    const completionMessage = await sendCampaignCompletionMessage(endedCampaign, rewards, bot);
    
    // Distribute rewards if applicable
    if (rewards.length > 0) {
      await distributeRewards(rewards, endedCampaign, bot);
      await endedCampaign.markRewardsDistributed();
    }
    
    return {
      campaign: endedCampaign,
      rewards,
      completionMessage
    };
  } catch (error) {
    logger.error('Error ending campaign:', error.message);
    throw new Error(`Failed to end campaign: ${error.message}`);
  }
};

/**
 * Send campaign completion message
 * @param {Campaign} campaign - Campaign instance
 * @param {Array} rewards - Calculated rewards
 * @param {TelegramBot} bot - Telegram bot instance
 * @returns {Object} Sent message
 */
const sendCampaignCompletionMessage = async (campaign, rewards, bot) => {
  try {
    // Get campaign statistics
    const stats = await campaign.getStatistics();
    
    // Format completion message
    let message = `🎉 *Campaign Completed: ${campaign.name}*\n\n`;
    
    // Add statistics
    message += `*Campaign Results:*\n`;
    message += `🚀 ${stats.raidCount} Raids completed\n`;
    message += `👥 ${stats.totalParticipants} Participants\n`;
    message += `⭐ ${stats.totalXp} Total XP earned\n`;
    message += `🏆 ${stats.qualifyingUsers} Users qualified for rewards\n\n`;
    
    // Add reward information
    if (rewards.length > 0) {
      const totalTokens = rewards.reduce((sum, reward) => sum + parseFloat(reward.tokenAmount), 0);
      
      message += `*Rewards:*\n`;
      message += `Total: ${totalTokens.toFixed(2)} ${campaign.tokenSymbol}\n`;
      message += `Recipients: ${rewards.length}\n`;
      message += `\nRewards are being distributed now.\n`;
    } else {
      message += `*No rewards distributed*\n`;
    }
    
    // Add leaderboard
    const leaderboard = await campaign.getLeaderboard(3);
    
    if (leaderboard.length > 0) {
      message += `\n*Top Contributors:*\n`;
      
      leaderboard.forEach((entry, index) => {
        let prefix = `${index + 1}.`;
        if (index === 0) prefix = '🥇';
        if (index === 1) prefix = '🥈';
        if (index === 2) prefix = '🥉';
        
        message += `${prefix} ${entry.username || entry.first_name || `User${entry.telegram_id}`}: ${entry.total_xp} XP\n`;
      });
    }
    
    // Add buttons for more details
    const keyboard = [
      [
        { text: '📊 Full Stats', callback_data: `stats_campaign_${campaign.id}` },
        { text: '🏆 Leaderboard', callback_data: `leaderboard_campaign_${campaign.id}` }
      ]
    ];
    
    // If rewards are available, add a claim button
    if (rewards.length > 0) {
      keyboard.push([
        { text: '💰 Claim Rewards', callback_data: `claim_campaign_${campaign.id}` }
      ]);
    }
    
    // Send message with inline keyboard
    return await bot.sendMessage(campaign.chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (error) {
    logger.error('Error sending campaign completion message:', error.message);
    throw new Error('Failed to send campaign completion message');
  }
};

/**
 * Check for campaigns that should be ended
 * @param {TelegramBot} bot - Telegram bot instance
 */
const checkForEndedCampaigns = async (bot) => {
  try {
    const supabase = getSupabase();
    
    // Find active campaigns that have ended
    const { data, error } = await supabase
      .from('campaigns')
      .select('id')
      .eq('is_active', true)
      .lt('end_date', new Date().toISOString());
    
    if (error) throw error;
    
    // End each campaign
    for (const item of data) {
      try {
        await endCampaign(item.id, bot);
        logger.info(`Automatically ended campaign: ${item.id}`);
      } catch (err) {
        logger.error(`Error ending campaign ${item.id}:`, err.message);
      }
    }
  } catch (error) {
    logger.error('Error checking for ended campaigns:', error.message);
  }
};

/**
 * Set up scheduled tasks
 * @param {TelegramBot} bot - Telegram bot instance
 */
const setupScheduledTasks = (bot) => {
  // Check for ended campaigns every hour
  setInterval(() => {
    checkForEndedCampaigns(bot);
  }, 60 * 60 * 1000); // 1 hour
};

module.exports = {
  createRaid,
  endRaid,
  recordUserAction,
  verifyUserActions,
  updateRaidStatusMessage,
  getRaidStatistics,
  createCampaign,
  endCampaign,
  setupScheduledTasks
};