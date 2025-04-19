/**
 * Campaign Model
 * Represents a multi-raid Twitter campaign with threshold-based rewards
 */

const logger = require('../utils/logger');
const { getSupabase } = require('../services/supabaseService');
const User = require('./userModel');
const { Raid, RaidStatus } = require('./raidModel');
const config = require('../../config/config');
const helpers = require('../utils/helpers');

/**
 * Campaign statuses
 * @enum {string}
 */
const CampaignStatus = {
  ACTIVE: 'active',       // Currently active
  COMPLETED: 'completed', // Finished and rewards distributed
  CANCELLED: 'cancelled'  // Cancelled by admin
};

/**
 * Campaign class representing a multi-raid Twitter campaign
 */
class Campaign {
  /**
   * Create a new Campaign instance
   * @param {Object} campaignData - Campaign data from database or constructor
   */
  constructor(campaignData = {}) {
    this.id = campaignData.id || null;
    this.name = campaignData.name || '';
    this.adminId = campaignData.admin_id || campaignData.adminId || null;
    this.chatId = campaignData.chat_id || campaignData.chatId || null;
    this.startDate = campaignData.start_date || campaignData.startDate || new Date();
    this.endDate = campaignData.end_date || campaignData.endDate || null;
    this.isActive = campaignData.is_active !== undefined ? campaignData.is_active : campaignData.isActive !== undefined ? campaignData.isActive : true;
    
    // Reward configuration
    this.tokenType = campaignData.token_type || campaignData.tokenType || null;
    this.tokenSymbol = campaignData.token_symbol || campaignData.tokenSymbol || null;
    this.totalBudget = campaignData.total_budget || campaignData.totalBudget || null;
    this.tokenPerXp = campaignData.token_per_xp || campaignData.tokenPerXp || null;
    this.thresholdXp = campaignData.threshold_xp || campaignData.thresholdXp || config.xp.defaultThreshold;
    
    // Additional properties
    this.description = campaignData.description || '';
    this.status = campaignData.status || CampaignStatus.ACTIVE;
    this.rewardsDistributed = campaignData.rewards_distributed || campaignData.rewardsDistributed || false;
  }
  
  /**
   * Validate campaign data
   * @returns {Object} Validation result {isValid, errors}
   */
  validate() {
    const errors = [];
    
    // Required fields
    if (!this.name) {
      errors.push('Campaign name is required');
    }
    
    if (!this.adminId) {
      errors.push('Admin ID is required');
    }
    
    if (!this.chatId) {
      errors.push('Chat ID is required');
    }
    
    if (!this.endDate) {
      errors.push('End date is required');
    }
    
    if (!this.thresholdXp || this.thresholdXp <= 0) {
      errors.push('Threshold XP must be greater than 0');
    }
    
    // Reward configuration validation
    if ((this.totalBudget || this.tokenPerXp) && (!this.tokenType || !this.tokenSymbol)) {
      errors.push('Token type and symbol are required for rewards');
    }
    
    // Ensure end date is after start date
    if (this.startDate && this.endDate) {
      const start = new Date(this.startDate);
      const end = new Date(this.endDate);
      
      if (end <= start) {
        errors.push('End date must be after start date');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Save campaign to database (create or update)
   * @returns {Campaign} Updated campaign instance
   */
  async save() {
    const supabase = getSupabase();
    
    // Validate campaign data
    const { isValid, errors } = this.validate();
    if (!isValid) {
      throw new Error(`Campaign validation failed: ${errors.join(', ')}`);
    }
    
    // Prepare data for database
    const campaignData = {
      name: this.name,
      admin_id: this.adminId,
      chat_id: this.chatId,
      start_date: this.startDate instanceof Date ? this.startDate.toISOString() : this.startDate,
      end_date: this.endDate instanceof Date ? this.endDate.toISOString() : this.endDate,
      is_active: this.isActive,
      token_type: this.tokenType,
      token_symbol: this.tokenSymbol,
      total_budget: this.totalBudget,
      token_per_xp: this.tokenPerXp,
      threshold_xp: this.thresholdXp,
      description: this.description,
      status: this.status,
      rewards_distributed: this.rewardsDistributed
    };
    
    try {
      let result;
      
      if (this.id) {
        // Update existing campaign
        const { data, error } = await supabase
          .from('campaigns')
          .update(campaignData)
          .eq('id', this.id)
          .select()
          .single();
        
        if (error) throw error;
        result = data;
        logger.debug(`Updated campaign: ${this.id}`);
      } else {
        // Create new campaign
        const { data, error } = await supabase
          .from('campaigns')
          .insert(campaignData)
          .select()
          .single();
        
        if (error) throw error;
        result = data;
        logger.info(`Created new campaign: ${result.id}`);
      }
      
      // Update instance with returned data
      return new Campaign(result);
    } catch (error) {
      logger.error('Error saving campaign:', error.message);
      throw new Error(`Failed to save campaign: ${error.message}`);
    }
  }
  
  /**
   * Find a campaign by ID
   * @param {number} id - Campaign ID
   * @returns {Campaign|null} Campaign instance or null if not found
   */
  static async findById(id) {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) {
        // If no rows returned, campaign doesn't exist
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }
      
      return new Campaign(data);
    } catch (error) {
      logger.error('Error finding campaign by ID:', error.message);
      throw new Error(`Failed to find campaign: ${error.message}`);
    }
  }
  
  /**
   * Find active campaign for a specific chat
   * @param {number} chatId - Telegram chat ID
   * @returns {Campaign|null} Campaign instance or null if not found
   */
  static async findActiveByChatId(chatId) {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('chat_id', chatId)
        .eq('is_active', true)
        .order('start_date', { ascending: false })
        .limit(1)
        .single();
      
      if (error) {
        // If no rows returned, no active campaign
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }
      
      return new Campaign(data);
    } catch (error) {
      logger.error('Error finding active campaign for chat:', error.message);
      return null; // Return null instead of throwing to make this easier to use
    }
  }
  
  /**
   * End the campaign
   * @param {Object} options - End options
   * @returns {Campaign} Updated campaign instance
   */
  async end(options = {}) {
    // Set status based on options
    if (options.cancelled) {
      this.status = CampaignStatus.CANCELLED;
    } else {
      this.status = CampaignStatus.COMPLETED;
    }
    
    this.isActive = false;
    
    // Save changes
    return await this.save();
  }
  
  /**
   * Add a raid to this campaign
   * @param {Raid|Object} raid - Raid instance or data
   * @returns {Raid} Created or updated raid
   */
  async addRaid(raid) {
    try {
      // If raid is not a Raid instance, create one
      const raidInstance = raid instanceof Raid ? raid : new Raid(raid);
      
      // Set campaign ID
      raidInstance.campaignId = this.id;
      
      // Copy token settings if not set
      if (!raidInstance.tokenType) raidInstance.tokenType = this.tokenType;
      if (!raidInstance.tokenSymbol) raidInstance.tokenSymbol = this.tokenSymbol;
      if (!raidInstance.tokenPerXp) raidInstance.tokenPerXp = this.tokenPerXp;
      if (!raidInstance.thresholdXp) raidInstance.thresholdXp = this.thresholdXp;
      
      // Save raid
      return await raidInstance.save();
    } catch (error) {
      logger.error('Error adding raid to campaign:', error.message);
      throw new Error(`Failed to add raid to campaign: ${error.message}`);
    }
  }
  
  /**
   * Get all raids in this campaign
   * @returns {Array<Raid>} Array of Raid instances
   */
  async getRaids() {
    return await Raid.findByCampaignId(this.id);
  }
  
  /**
   * Get user's XP for this campaign
   * @param {number} telegramId - User's Telegram ID
   * @returns {number} Total XP for campaign
   */
  async getUserXp(telegramId) {
    try {
      const supabase = getSupabase();
      
      // Get all XP transactions for this user in this campaign
      const { data, error } = await supabase
        .from('xp_transactions')
        .select('amount')
        .eq('user_id', telegramId)
        .or(`source_type.eq.campaign,and(source_type.eq.raid,source_id.in.(${await this.getRaidIdsQuery()}))`);
      
      if (error) throw error;
      
      // Sum up all XP
      return data.reduce((total, transaction) => total + transaction.amount, 0);
    } catch (error) {
      logger.error('Error getting user XP for campaign:', error.message);
      return 0;
    }
  }
  
  /**
   * Get a comma-separated list of raid IDs for this campaign
   * @returns {string} Comma-separated raid IDs
   */
  async getRaidIdsQuery() {
    try {
      const raids = await this.getRaids();
      return raids.map(raid => raid.id).join(',');
    } catch (error) {
      logger.error('Error getting raid IDs:', error.message);
      return '';
    }
  }
  
  /**
   * Calculate user's progress toward threshold
   * @param {number} telegramId - User's Telegram ID
   * @returns {Object} Progress information
   */
  async getUserProgress(telegramId) {
    try {
      const xp = await this.getUserXp(telegramId);
      const percentage = Math.min(100, Math.round((xp / this.thresholdXp) * 100));
      const remaining = Math.max(0, this.thresholdXp - xp);
      
      return {
        xp,
        threshold: this.thresholdXp,
        percentage,
        remaining,
        completed: xp >= this.thresholdXp
      };
    } catch (error) {
      logger.error('Error calculating user progress:', error.message);
      return {
        xp: 0,
        threshold: this.thresholdXp,
        percentage: 0,
        remaining: this.thresholdXp,
        completed: false
      };
    }
  }
  
  /**
   * Get campaign leaderboard
   * @param {number} limit - Maximum number of users to return
   * @returns {Array} Leaderboard entries
   */
  async getLeaderboard(limit = 10) {
    try {
      const supabase = getSupabase();
      
      // Get raid IDs for this campaign
      const raidIds = await this.getRaidIdsQuery();
      
      // Get total XP per user for this campaign
      const { data, error } = await supabase
        .rpc('get_campaign_leaderboard', {
          campaign_id_param: this.id,
          raid_ids_param: `{${raidIds}}`,
          limit_param: limit
        });
      
      if (error) throw error;
      
      return data;
    } catch (error) {
      logger.error('Error getting campaign leaderboard:', error.message);
      return [];
    }
  }
  
  /**
   * Check if campaign has ended
   * @returns {boolean} True if campaign has ended
   */
  hasEnded() {
    if (!this.isActive) {
      return true;
    }
    
    if (this.endDate) {
      const now = new Date();
      const end = new Date(this.endDate);
      return now >= end;
    }
    
    return false;
  }
  
  /**
   * Get time until campaign ends
   * @returns {string} Human-readable time remaining
   */
  getTimeRemaining() {
    if (!this.isActive) {
      return 'Campaign has ended';
    }
    
    if (this.endDate) {
      return helpers.timeUntil(this.endDate);
    }
    
    return 'No end date set';
  }
  
  /**
   * Calculate reward for a user
   * @param {number} telegramId - User's Telegram ID
   * @returns {Object} Reward calculation
   */
  async calculateUserReward(telegramId) {
    try {
      // Get user's XP for this campaign
      const { xp, completed } = await this.getUserProgress(telegramId);
      
      // Check if user meets threshold requirements
      if (!completed) {
        return {
          eligible: false,
          reason: `You need at least ${this.thresholdXp} XP (you have ${xp})`,
          xp,
          threshold: this.thresholdXp
        };
      }
      
      // Get user to check wallet
      const user = await User.findByTelegramId(telegramId);
      if (!user || !user.hasSuiWalletConnected()) {
        return {
          eligible: false,
          reason: 'You need to connect a Sui wallet to receive rewards',
          xp
        };
      }
      
      // Calculate reward based on XP earned
      let tokenAmount = 0;
      
      if (this.tokenPerXp) {
        // Fixed rate per XP
        tokenAmount = xp * this.tokenPerXp;
      } else if (this.totalBudget) {
        // Pro-rata share of total budget among qualifying users
        const qualifyingUsers = await this.getQualifyingUsers();
        const totalQualifyingXp = qualifyingUsers.reduce((total, user) => total + user.xp, 0);
        
        if (totalQualifyingXp > 0) {
          tokenAmount = (xp / totalQualifyingXp) * this.totalBudget;
        }
      }
      
      return {
        eligible: true,
        xp,
        tokenAmount,
        tokenSymbol: this.tokenSymbol,
        tokenType: this.tokenType,
        walletAddress: user.suiWalletAddress
      };
    } catch (error) {
      logger.error('Error calculating user reward:', error.message);
      return { eligible: false, reason: 'Error calculating reward' };
    }
  }
  
  /**
   * Get all users who qualify for rewards
   * @returns {Array} Array of qualifying users
   */
  async getQualifyingUsers() {
    try {
      const supabase = getSupabase();
      
      // Get raid IDs for this campaign
      const raidIds = await this.getRaidIdsQuery();
      
      // Build query to get all XP transactions for raids in this campaign
      const xpQuery = `
        SELECT 
          user_id,
          SUM(amount) as total_xp
        FROM xp_transactions
        WHERE 
          (source_type = 'campaign' AND source_id = ${this.id})
          OR (source_type = 'raid' AND source_id IN (${raidIds}))
        GROUP BY user_id
        HAVING SUM(amount) >= ${this.thresholdXp}
      `;
      
      // Execute query
      const { data: xpData, error: xpError } = await supabase.rpc('run_query', {
        query_text: xpQuery
      });
      
      if (xpError) throw xpError;
      
      // Get user details for qualifying users
      const qualifyingUsers = [];
      
      for (const entry of xpData) {
        const user = await User.findByTelegramId(entry.user_id);
        
        if (user && user.hasSuiWalletConnected()) {
          qualifyingUsers.push({
            telegramId: user.telegramId,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            walletAddress: user.suiWalletAddress,
            xp: entry.total_xp
          });
        }
      }
      
      return qualifyingUsers;
    } catch (error) {
      logger.error('Error getting qualifying users:', error.message);
      return [];
    }
  }
  
  /**
   * Calculate rewards for all qualifying users
   * @returns {Array} Array of user rewards
   */
  async calculateAllRewards() {
    try {
      // Get all qualifying users
      const qualifyingUsers = await this.getQualifyingUsers();
      
      if (qualifyingUsers.length === 0) {
        return [];
      }
      
      const rewards = [];
      
      if (this.tokenPerXp) {
        // Fixed rate per XP
        for (const user of qualifyingUsers) {
          rewards.push({
            telegramId: user.telegramId,
            walletAddress: user.walletAddress,
            xpAmount: user.xp,
            tokenAmount: user.xp * this.tokenPerXp,
            tokenSymbol: this.tokenSymbol,
            tokenType: this.tokenType,
            campaignId: this.id
          });
        }
      } else if (this.totalBudget) {
        // Pro-rata share of total budget
        const totalXp = qualifyingUsers.reduce((total, user) => total + user.xp, 0);
        
        for (const user of qualifyingUsers) {
          rewards.push({
            telegramId: user.telegramId,
            walletAddress: user.walletAddress,
            xpAmount: user.xp,
            tokenAmount: (user.xp / totalXp) * this.totalBudget,
            tokenSymbol: this.tokenSymbol,
            tokenType: this.tokenType,
            campaignId: this.id
          });
        }
      }
      
      return rewards;
    } catch (error) {
      logger.error('Error calculating all rewards:', error.message);
      throw new Error('Failed to calculate rewards');
    }
  }
  
  /**
   * Mark campaign rewards as distributed
   * @returns {Campaign} Updated campaign instance
   */
  async markRewardsDistributed() {
    this.rewardsDistributed = true;
    return await this.save();
  }
  
  /**
   * Get campaign statistics
   * @returns {Object} Campaign statistics
   */
  async getStatistics() {
    try {
      // Get all raids in this campaign
      const raids = await this.getRaids();
      
      // Get total participants count
      const supabase = getSupabase();
      const { count, error } = await supabase
        .from('xp_transactions')
        .select('user_id', { count: 'exact', head: true, distinct: true })
        .or(`source_type.eq.campaign,and(source_type.eq.raid,source_id.in.(${await this.getRaidIdsQuery()}))`);
      
      if (error) throw error;
      
      // Get total XP awarded
      const { data: xpData, error: xpError } = await supabase
        .from('xp_transactions')
        .select('sum')
        .or(`source_type.eq.campaign,and(source_type.eq.raid,source_id.in.(${await this.getRaidIdsQuery()}))`)
        .select('sum(amount)')
        .single();
      
      if (xpError) throw xpError;
      
      // Get qualifying users count
      const qualifyingUsers = await this.getQualifyingUsers();
      
      return {
        raidCount: raids.length,
        totalParticipants: count || 0,
        totalXp: xpData?.sum || 0,
        qualifyingUsers: qualifyingUsers.length,
        active: this.isActive,
        timeRemaining: this.getTimeRemaining(),
        rewardsDistributed: this.rewardsDistributed
      };
    } catch (error) {
      logger.error('Error getting campaign statistics:', error.message);
      return {
        raidCount: 0,
        totalParticipants: 0,
        totalXp: 0,
        qualifyingUsers: 0,
        active: this.isActive,
        timeRemaining: this.getTimeRemaining(),
        rewardsDistributed: this.rewardsDistributed
      };
    }
  }
}

module.exports = {
  Campaign,
  CampaignStatus
};