/**
 * Raid Model
 * Represents a Twitter raid campaign with methods for management and reward calculation
 */

const logger = require('../utils/logger');
const { getSupabase } = require('../services/supabaseService');
const User = require('./userModel');
const config = require('../../config/config');
const helpers = require('../utils/helpers');

/**
 * Raid statuses
 * @enum {string}
 */
const RaidStatus = {
  PENDING: 'pending',    // Created but not started
  ACTIVE: 'active',      // Currently active
  COMPLETED: 'completed', // Finished successfully
  FAILED: 'failed',      // Finished but didn't meet targets
  CANCELLED: 'cancelled'  // Cancelled by admin
};

/**
 * Raid class representing a Twitter raid campaign
 */
class Raid {
  /**
   * Create a new Raid instance
   * @param {Object} raidData - Raid data from database or constructor
   */
  constructor(raidData = {}) {
    this.id = raidData.id || null;
    this.tweetId = raidData.tweet_id || raidData.tweetId || null;
    this.tweetUrl = raidData.tweet_url || raidData.tweetUrl || null;
    this.adminId = raidData.admin_id || raidData.adminId || null;
    this.chatId = raidData.chat_id || raidData.chatId || null;
    this.startTime = raidData.start_time || raidData.startTime || new Date();
    this.endTime = raidData.end_time || raidData.endTime || null;
    this.isActive = raidData.is_active !== undefined ? raidData.is_active : raidData.isActive !== undefined ? raidData.isActive : true;
    
    // Targets
    this.targetLikes = raidData.target_likes || raidData.targetLikes || 0;
    this.targetRetweets = raidData.target_retweets || raidData.targetRetweets || 0;
    this.targetComments = raidData.target_comments || raidData.targetComments || a0;
    
    // Actual counts
    this.actualLikes = raidData.actual_likes || raidData.actualLikes || 0;
    this.actualRetweets = raidData.actual_retweets || raidData.actualRetweets || 0;
    this.actualComments = raidData.actual_comments || raidData.actualComments || 0;
    
    // Reward configuration
    this.tokenType = raidData.token_type || raidData.tokenType || null;
    this.tokenSymbol = raidData.token_symbol || raidData.tokenSymbol || null;
    this.totalReward = raidData.total_reward || raidData.totalReward || null;
    this.tokenPerXp = raidData.token_per_xp || raidData.tokenPerXp || null;
    this.thresholdXp = raidData.threshold_xp || raidData.thresholdXp || 0;
    
    // Campaign relationship
    this.campaignId = raidData.campaign_id || raidData.campaignId || null;
    
    // Additional properties
    this.status = raidData.status || RaidStatus.ACTIVE;
    this.messageId = raidData.message_id || raidData.messageId || null;
    this.duration = raidData.duration || 3600; // Default 1 hour in seconds
    this.requireVerification = raidData.require_verification || raidData.requireVerification || true;
    this.description = raidData.description || '';
  }
  
  /**
   * Validate raid data
   * @returns {Object} Validation result {isValid, errors}
   */
  validate() {
    const errors = [];
    
    // Required fields
    if (!this.tweetUrl) {
      errors.push('Tweet URL is required');
    }
    
    if (!this.adminId) {
      errors.push('Admin ID is required');
    }
    
    if (!this.chatId) {
      errors.push('Chat ID is required');
    }
    
    // Extract tweet ID from URL if not provided
    if (!this.tweetId && this.tweetUrl) {
      try {
        const tweetIdMatch = this.tweetUrl.match(/twitter\.com\/\w+\/status\/(\d+)/);
        if (tweetIdMatch) {
          this.tweetId = tweetIdMatch[1];
        } else {
          errors.push('Invalid Tweet URL format');
        }
      } catch (e) {
        errors.push('Failed to extract Tweet ID from URL');
      }
    }
    
    // Reward configuration validation
    if (this.totalReward && (!this.tokenType || !this.tokenSymbol)) {
      errors.push('Token type and symbol are required for rewards');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Save raid to database (create or update)
   * @returns {Raid} Updated raid instance
   */
  async save() {
    const supabase = getSupabase();
    
    // Validate raid data
    const { isValid, errors } = this.validate();
    if (!isValid) {
      throw new Error(`Raid validation failed: ${errors.join(', ')}`);
    }
    
    // Prepare data for database
    const raidData = {
      tweet_id: this.tweetId,
      tweet_url: this.tweetUrl,
      admin_id: this.adminId,
      chat_id: this.chatId,
      start_time: this.startTime instanceof Date ? this.startTime.toISOString() : this.startTime,
      end_time: this.endTime instanceof Date ? this.endTime.toISOString() : this.endTime,
      is_active: this.isActive,
      target_likes: this.targetLikes,
      target_retweets: this.targetRetweets,
      target_comments: this.targetComments,
      actual_likes: this.actualLikes,
      actual_retweets: this.actualRetweets,
      actual_comments: this.actualComments,
      token_type: this.tokenType,
      token_symbol: this.tokenSymbol,
      total_reward: this.totalReward,
      token_per_xp: this.tokenPerXp,
      threshold_xp: this.thresholdXp,
      campaign_id: this.campaignId,
      status: this.status,
      message_id: this.messageId,
      duration: this.duration,
      require_verification: this.requireVerification,
      description: this.description
    };
    
    try {
      let result;
      
      if (this.id) {
        // Update existing raid
        const { data, error } = await supabase
          .from('raids')
          .update(raidData)
          .eq('id', this.id)
          .select()
          .single();
        
        if (error) throw error;
        result = data;
        logger.debug(`Updated raid: ${this.id}`);
      } else {
        // Create new raid
        const { data, error } = await supabase
          .from('raids')
          .insert(raidData)
          .select()
          .single();
        
        if (error) throw error;
        result = data;
        logger.info(`Created new raid: ${result.id}`);
      }
      
      // Update instance with returned data
      return new Raid(result);
    } catch (error) {
      logger.error('Error saving raid:', error.message);
      throw new Error(`Failed to save raid: ${error.message}`);
    }
  }
  
  /**
   * Find a raid by ID
   * @param {number} id - Raid ID
   * @returns {Raid|null} Raid instance or null if not found
   */
  static async findById(id) {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('raids')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) {
        // If no rows returned, raid doesn't exist
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }
      
      return new Raid(data);
    } catch (error) {
      logger.error('Error finding raid by ID:', error.message);
      throw new Error(`Failed to find raid: ${error.message}`);
    }
  }
  
  /**
   * Find active raid for a specific chat
   * @param {number} chatId - Telegram chat ID
   * @returns {Raid|null} Raid instance or null if not found
   */
  static async findActiveByChatId(chatId) {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('raids')
        .select('*')
        .eq('chat_id', chatId)
        .eq('is_active', true)
        .order('start_time', { ascending: false })
        .limit(1)
        .single();
      
      if (error) {
        // If no rows returned, no active raid
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }
      
      return new Raid(data);
    } catch (error) {
      logger.error('Error finding active raid for chat:', error.message);
      return null; // Return null instead of throwing to make this easier to use
    }
  }
  
  /**
   * End the raid
   * @param {Object} options - End options
   * @returns {Raid} Updated raid instance
   */
  async end(options = {}) {
    // Set end time if not already set
    if (!this.endTime) {
      this.endTime = new Date();
    }
    
    // Set status based on targets and options
    if (options.cancelled) {
      this.status = RaidStatus.CANCELLED;
    } else {
      const targetMet = this.isTargetMet();
      this.status = targetMet ? RaidStatus.COMPLETED : RaidStatus.FAILED;
    }
    
    this.isActive = false;
    
    // Save changes
    return await this.save();
  }
  
  /**
   * Check if raid target is met
   * @returns {boolean} True if target is met
   */
  isTargetMet() {
    // If no targets set, consider it met
    if (this.targetLikes === 0 && this.targetRetweets === 0 && this.targetComments === 0) {
      return true;
    }
    
    // Check if actual values meet or exceed targets
    const likesOk = this.actualLikes >= this.targetLikes;
    const retweetsOk = this.actualRetweets >= this.targetRetweets;
    const commentsOk = this.actualComments >= this.targetComments;
    
    return likesOk && retweetsOk && commentsOk;
  }
  
  /**
   * Calculate completion percentage
   * @returns {number} Percentage complete (0-100)
   */
  getCompletionPercentage() {
    // If no targets set, consider it 100%
    if (this.targetLikes === 0 && this.targetRetweets === 0 && this.targetComments === 0) {
      return 100;
    }
    
    let totalTargets = 0;
    let completedTargets = 0;
    
    if (this.targetLikes > 0) {
      totalTargets += this.targetLikes;
      completedTargets += Math.min(this.actualLikes, this.targetLikes);
    }
    
    if (this.targetRetweets > 0) {
      totalTargets += this.targetRetweets;
      completedTargets += Math.min(this.actualRetweets, this.targetRetweets);
    }
    
    if (this.targetComments > 0) {
      totalTargets += this.targetComments;
      completedTargets += Math.min(this.actualComments, this.targetComments);
    }
    
    if (totalTargets === 0) {
      return 100;
    }
    
    return Math.round((completedTargets / totalTargets) * 100);
  }
  
  /**
   * Record a user action for this raid
   * @param {number} telegramId - User's Telegram ID
   * @param {string} actionType - Action type (like, retweet, comment, bookmark)
   * @param {Object} actionData - Additional action data
   * @returns {Object} Result of the action recording
   */
  async recordUserAction(telegramId, actionType, actionData = {}) {
    try {
      if (!this.isActive) {
        return { success: false, error: 'Raid is not active' };
      }
      
      const supabase = getSupabase();
      
      // Check if user has already performed this action
      const { data: existingAction, error: checkError } = await supabase
        .from('user_actions')
        .select('*')
        .eq('user_id', telegramId)
        .eq('raid_id', this.id)
        .eq('action_type', actionType)
        .single();
      
      if (!checkError && existingAction) {
        return { 
          success: false, 
          error: 'You have already performed this action',
          existing: true
        };
      }
      
      // Calculate XP based on action type and data
      let xpEarned = this.getXpForAction(actionType, actionData);
      
      // Check if user has completed previous actions
      // e.g., if they haven't liked the tweet, they get less XP for a retweet
      if (actionType !== 'like') {
        const { data: hasLiked } = await supabase
          .from('user_actions')
          .select('*')
          .eq('user_id', telegramId)
          .eq('raid_id', this.id)
          .eq('action_type', 'like')
          .single();
          
        if (!hasLiked) {
          // Apply penalty for not completing core actions first
          xpEarned = Math.floor(xpEarned * 0.75);
        }
      }
      
      // Record the action
      const { error } = await supabase
        .from('user_actions')
        .insert({
          user_id: telegramId,
          raid_id: this.id,
          action_type: actionType,
          xp_earned: xpEarned,
          verified: actionData.verified || false,
          comment_text: actionData.commentText || null,
          comment_has_media: actionData.hasMedia || false,
          twitter_action_id: actionData.twitterActionId || null
        });
      
      if (error) throw error;
      
      // Add XP to user
      const user = await User.findByTelegramId(telegramId);
      if (user) {
        await user.addXp(xpEarned, 'raid', this.id);
      }
      
      // Update raid statistics
      await this.updateStatistics();
      
      return {
        success: true,
        xpEarned,
        action: actionType
      };
    } catch (error) {
      logger.error('Error recording user action:', error.message);
      return { success: false, error: 'Failed to record action' };
    }
  }
  
  /**
   * Get XP for a specific action
   * @param {string} actionType - Action type (like, retweet, comment, bookmark)
   * @param {Object} actionData - Additional action data
   * @returns {number} XP amount
   */
  getXpForAction(actionType, actionData = {}) {
    const xpConfig = config.xp.actions;
    
    switch (actionType) {
      case 'like':
        return xpConfig.like;
      case 'retweet':
        return xpConfig.retweet;
      case 'comment':
        // Check if comment has media
        if (actionData.hasMedia) {
          if (actionData.isGif) {
            return xpConfig.commentWithGif;
          }
          return xpConfig.commentWithImage;
        }
        return xpConfig.comment;
      case 'bookmark':
        return xpConfig.bookmark;
      default:
        return 0;
    }
  }
  
  /**
   * Update raid statistics based on user actions
   * @returns {Raid} Updated raid instance
   */
  async updateStatistics() {
    try {
      const supabase = getSupabase();
      
      // Get count of each action type
      const { data, error } = await supabase
        .from('user_actions')
        .select('action_type, count')
        .eq('raid_id', this.id)
        .group('action_type');
      
      if (error) throw error;
      
      // Update actual counts
      let likes = 0;
      let retweets = 0;
      let comments = 0;
      
      data.forEach(item => {
        if (item.action_type === 'like') likes = item.count;
        if (item.action_type === 'retweet') retweets = item.count;
        if (item.action_type === 'comment') comments = item.count;
      });
      
      this.actualLikes = likes;
      this.actualRetweets = retweets;
      this.actualComments = comments;
      
      // Save changes
      return await this.save();
    } catch (error) {
      logger.error('Error updating raid statistics:', error.message);
      throw new Error('Failed to update raid statistics');
    }
  }
  
  /**
   * Get user actions for this raid
   * @returns {Array} Array of user actions
   */
  async getUserActions() {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('user_actions')
        .select(`
          *,
          user:user_id (
            telegram_id,
            first_name,
            last_name,
            username,
            is_verified,
            twitter_username
          )
        `)
        .eq('raid_id', this.id)
        .order('timestamp', { ascending: false });
      
      if (error) throw error;
      
      return data;
    } catch (error) {
      logger.error('Error getting raid user actions:', error.message);
      return [];
    }
  }
  
  /**
   * Get leaderboard for this raid
   * @param {number} limit - Maximum number of users to return
   * @returns {Array} Leaderboard entries
   */
  async getLeaderboard(limit = 10) {
    try {
      const supabase = getSupabase();
      
      // Get total XP per user for this raid
      const { data, error } = await supabase
        .rpc('get_raid_leaderboard', {
          raid_id_param: this.id,
          limit_param: limit
        });
      
      if (error) throw error;
      
      return data;
    } catch (error) {
      logger.error('Error getting raid leaderboard:', error.message);
      return [];
    }
  }
  
  /**
   * Calculate reward for a user
   * @param {number} telegramId - User's Telegram ID
   * @returns {Object} Reward calculation
   */
  async calculateUserReward(telegramId) {
    try {
      // Get user's XP for this raid
      const user = await User.findByTelegramId(telegramId);
      if (!user) {
        return { eligible: false, reason: 'User not found' };
      }
      
      const userXp = await user.getXpForSource('raid', this.id);
      
      // Check if user meets threshold requirements
      if (this.thresholdXp > 0 && userXp < this.thresholdXp) {
        return {
          eligible: false,
          reason: `You need at least ${this.thresholdXp} XP (you have ${userXp})`,
          xp: userXp,
          threshold: this.thresholdXp
        };
      }
      
      // Check if raid was successful
      if (this.status === RaidStatus.FAILED && !this.isCampaignRaid()) {
        return {
          eligible: false,
          reason: 'Raid did not meet targets',
          xp: userXp
        };
      }
      
      // Calculate reward based on XP earned
      let tokenAmount = 0;
      
      if (this.tokenPerXp) {
        // Fixed rate per XP
        tokenAmount = userXp * this.tokenPerXp;
      } else if (this.totalReward) {
        // Pro-rata share of total reward
        const totalXp = await this.getTotalXp();
        if (totalXp > 0) {
          tokenAmount = (userXp / totalXp) * this.totalReward;
        }
      }
      
      return {
        eligible: true,
        xp: userXp,
        tokenAmount,
        tokenSymbol: this.tokenSymbol,
        tokenType: this.tokenType
      };
    } catch (error) {
      logger.error('Error calculating user reward:', error.message);
      return { eligible: false, reason: 'Error calculating reward' };
    }
  }
  
  /**
   * Calculate rewards for all users
   * @returns {Array} Array of user rewards
   */
  async calculateAllRewards() {
    try {
      const supabase = getSupabase();
      
      // Get all users who participated in this raid
      const { data, error } = await supabase
        .from('xp_transactions')
        .select(`
          user_id,
          sum(amount) as total_xp,
          users!inner (
            telegram_id,
            sui_wallet_address,
            sui_wallet_connected
          )
        `)
        .eq('source_type', 'raid')
        .eq('source_id', this.id)
        .group('user_id, users.telegram_id, users.sui_wallet_address, users.sui_wallet_connected')
        .order('total_xp', { ascending: false });
      
      if (error) throw error;
      
      const rewards = [];
      let totalEligibleXp = 0;
      
      // First pass: identify eligible users and calculate total eligible XP
      const eligibleUsers = data.filter(entry => {
        // Skip users without wallet
        if (!entry.users.sui_wallet_connected || !entry.users.sui_wallet_address) {
          return false;
        }
        
        // Check threshold
        if (this.thresholdXp > 0 && entry.total_xp < this.thresholdXp) {
          return false;
        }
        
        totalEligibleXp += entry.total_xp;
        return true;
      });
      
      // Second pass: calculate actual rewards
      for (const entry of eligibleUsers) {
        let tokenAmount = 0;
        
        if (this.tokenPerXp) {
          // Fixed rate per XP
          tokenAmount = entry.total_xp * this.tokenPerXp;
        } else if (this.totalReward && totalEligibleXp > 0) {
          // Pro-rata share of total reward
          tokenAmount = (entry.total_xp / totalEligibleXp) * this.totalReward;
        }
        
        rewards.push({
          telegramId: entry.users.telegram_id,
          walletAddress: entry.users.sui_wallet_address,
          xpAmount: entry.total_xp,
          tokenAmount,
          tokenSymbol: this.tokenSymbol,
          tokenType: this.tokenType,
          raidId: this.id,
          campaignId: this.campaignId
        });
      }
      
      return rewards;
    } catch (error) {
      logger.error('Error calculating all rewards:', error.message);
      throw new Error('Failed to calculate rewards');
    }
  }
  
  /**
   * Get total XP earned in this raid
   * @returns {number} Total XP
   */
  async getTotalXp() {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('xp_transactions')
        .select('sum(amount)')
        .eq('source_type', 'raid')
        .eq('source_id', this.id)
        .single();
      
      if (error) throw error;
      
      return data.sum || 0;
    } catch (error) {
      logger.error('Error getting total raid XP:', error.message);
      return 0;
    }
  }
  
  /**
   * Check if this is part of a campaign
   * @returns {boolean} True if part of a campaign
   */
  isCampaignRaid() {
    return !!this.campaignId;
  }
  
  /**
   * Get time until raid ends
   * @returns {string} Human-readable time remaining
   */
  getTimeRemaining() {
    if (!this.isActive) {
      return 'Raid has ended';
    }
    
    if (this.endTime) {
      return helpers.timeUntil(this.endTime);
    }
    
    // Calculate based on start time + duration
    const endTimeEstimate = new Date(this.startTime);
    endTimeEstimate.setSeconds(endTimeEstimate.getSeconds() + this.duration);
    
    return helpers.timeUntil(endTimeEstimate);
  }
  
  /**
   * Get raids for a campaign
   * @param {number} campaignId - Campaign ID
   * @returns {Array<Raid>} Array of Raid instances
   */
  static async findByCampaignId(campaignId) {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('raids')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('start_time', { ascending: false });
      
      if (error) throw error;
      
      return data.map(raidData => new Raid(raidData));
    } catch (error) {
      logger.error('Error finding raids by campaign ID:', error.message);
      return [];
    }
  }
}

module.exports = {
  Raid,
  RaidStatus
};