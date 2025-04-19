/**
 * User Model
 * Represents a user in the system with methods for persistence and validation
 */

const logger = require('../utils/logger');
const { getSupabase } = require('../services/supabaseService');
const helpers = require('../utils/helpers');

/**
 * User class representing a user in the system
 */
class User {
  /**
   * Create a new User instance
   * @param {Object} userData - User data from database or constructor
   */
  constructor(userData = {}) {
    this.id = userData.id || null;
    this.telegramId = userData.telegram_id || userData.telegramId || null;
    this.firstName = userData.first_name || userData.firstName || null;
    this.lastName = userData.last_name || userData.lastName || null;
    this.username = userData.username || null;
    this.languageCode = userData.language_code || userData.languageCode || null;
    this.joinedDate = userData.joined_date || userData.joinedDate || new Date();
    this.lastActive = userData.last_active || userData.lastActive || new Date();
    this.isAdmin = userData.is_admin || userData.isAdmin || false;
    this.isVerified = userData.is_verified || userData.isVerified || false;
    this.totalXp = userData.total_xp || userData.totalXp || 0;
    
    // Twitter-related fields
    this.twitterId = userData.twitter_id || userData.twitterId || null;
    this.twitterUsername = userData.twitter_username || userData.twitterUsername || null;
    this.twitterToken = userData.twitter_token || userData.twitterToken || null;
    this.twitterTokenSecret = userData.twitter_token_secret || userData.twitterTokenSecret || null;
    this.twitterRefreshToken = userData.twitter_refresh_token || userData.twitterRefreshToken || null;
    this.twitterTokenExpiresAt = userData.twitter_token_expires_at || userData.twitterTokenExpiresAt || null;
    this.twitterConnected = userData.twitter_connected || userData.twitterConnected || false;
    this.twitterConnectedAt = userData.twitter_connected_at || userData.twitterConnectedAt || null;
    
    // Sui wallet-related fields
    this.suiWalletAddress = userData.sui_wallet_address || userData.suiWalletAddress || null;
    this.suiWalletConnected = userData.sui_wallet_connected || userData.suiWalletConnected || false;
    this.suiWalletConnectedAt = userData.sui_wallet_connected_at || userData.suiWalletConnectedAt || null;
    this.suiWalletGenerated = userData.sui_wallet_generated || userData.suiWalletGenerated || false;
  }
  
  /**
   * Validate user data
   * @returns {Object} Validation result {isValid, errors}
   */
  validate() {
    const errors = [];
    
    // Required fields
    if (!this.telegramId) {
      errors.push('Telegram ID is required');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Save user to database (create or update)
   * @returns {User} Updated user instance
   */
  async save() {
    const supabase = getSupabase();
    
    // Validate user data
    const { isValid, errors } = this.validate();
    if (!isValid) {
      throw new Error(`User validation failed: ${errors.join(', ')}`);
    }
    
    // Prepare data for database
    const userData = {
      telegram_id: this.telegramId,
      first_name: this.firstName,
      last_name: this.lastName,
      username: this.username,
      language_code: this.languageCode,
      last_active: new Date().toISOString(),
      is_admin: this.isAdmin,
      is_verified: this.isVerified,
      total_xp: this.totalXp,
      twitter_id: this.twitterId,
      twitter_username: this.twitterUsername,
      twitter_token: this.twitterToken,
      twitter_token_secret: this.twitterTokenSecret,
      twitter_refresh_token: this.twitterRefreshToken,
      twitter_token_expires_at: this.twitterTokenExpiresAt,
      twitter_connected: this.twitterConnected,
      twitter_connected_at: this.twitterConnectedAt,
      sui_wallet_address: this.suiWalletAddress,
      sui_wallet_connected: this.suiWalletConnected,
      sui_wallet_connected_at: this.suiWalletConnectedAt,
      sui_wallet_generated: this.suiWalletGenerated
    };
    
    try {
      // Check if user exists
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', this.telegramId)
        .single();
      
      let result;
      
      if (existingUser) {
        // Update existing user
        const { data, error } = await supabase
          .from('users')
          .update(userData)
          .eq('telegram_id', this.telegramId)
          .select()
          .single();
        
        if (error) throw error;
        result = data;
        logger.debug(`Updated user: ${this.telegramId}`);
      } else {
        // Create new user
        userData.joined_date = new Date().toISOString();
        
        const { data, error } = await supabase
          .from('users')
          .insert(userData)
          .select()
          .single();
        
        if (error) throw error;
        result = data;
        logger.info(`Created new user: ${this.telegramId}`);
      }
      
      // Update instance with returned data
      return new User(result);
    } catch (error) {
      logger.error('Error saving user:', error.message);
      throw new Error(`Failed to save user: ${error.message}`);
    }
  }
  
  /**
   * Find a user by Telegram ID
   * @param {number} telegramId - Telegram user ID
   * @returns {User|null} User instance or null if not found
   */
  static async findByTelegramId(telegramId) {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();
      
      if (error) {
        // If no rows returned, user doesn't exist
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }
      
      return new User(data);
    } catch (error) {
      logger.error('Error finding user by Telegram ID:', error.message);
      throw new Error(`Failed to find user: ${error.message}`);
    }
  }
  
  /**
   * Find a user by Twitter ID
   * @param {string} twitterId - Twitter user ID
   * @returns {User|null} User instance or null if not found
   */
  static async findByTwitterId(twitterId) {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('twitter_id', twitterId)
        .single();
      
      if (error) {
        // If no rows returned, user doesn't exist
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }
      
      return new User(data);
    } catch (error) {
      logger.error('Error finding user by Twitter ID:', error.message);
      throw new Error(`Failed to find user: ${error.message}`);
    }
  }
  
  /**
   * Find a user by Sui wallet address
   * @param {string} walletAddress - Sui wallet address
   * @returns {User|null} User instance or null if not found
   */
  static async findBySuiWalletAddress(walletAddress) {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('sui_wallet_address', walletAddress)
        .single();
      
      if (error) {
        // If no rows returned, user doesn't exist
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }
      
      return new User(data);
    } catch (error) {
      logger.error('Error finding user by wallet address:', error.message);
      throw new Error(`Failed to find user: ${error.message}`);
    }
  }
  
  /**
   * Add XP to user
   * @param {number} amount - Amount of XP to add
   * @param {string} sourceType - Source of XP (raid, campaign, etc.)
   * @param {number} sourceId - ID of the source
   * @returns {User} Updated user instance
   */
  async addXp(amount, sourceType, sourceId) {
    try {
      const supabase = getSupabase();
      
      // Start by recording the XP transaction
      const { error: logError } = await supabase
        .from('xp_transactions')
        .insert({
          user_id: this.telegramId,
          amount: amount,
          source_type: sourceType,
          source_id: sourceId,
          previous_total: this.totalXp,
          new_total: this.totalXp + amount,
          timestamp: new Date().toISOString()
        });
      
      if (logError) throw logError;
      
      // Update user's total XP
      this.totalXp += amount;
      
      // Save updated user
      return await this.save();
    } catch (error) {
      logger.error('Error adding XP to user:', error.message);
      throw new Error(`Failed to add XP to user: ${error.message}`);
    }
  }
  
  /**
   * Get user's XP for a specific campaign or raid
   * @param {string} sourceType - Source type ('raid' or 'campaign')
   * @param {number} sourceId - ID of the raid or campaign
   * @returns {number} Total XP for that source
   */
  async getXpForSource(sourceType, sourceId) {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('xp_transactions')
        .select('amount')
        .eq('user_id', this.telegramId)
        .eq('source_type', sourceType)
        .eq('source_id', sourceId);
      
      if (error) throw error;
      
      // Sum up all XP from this source
      return data.reduce((sum, record) => sum + record.amount, 0);
    } catch (error) {
      logger.error('Error getting user XP for source:', error.message);
      return 0; // Default to 0 on error
    }
  }
  
  /**
   * Connect Twitter account
   * @param {Object} twitterData - Twitter account data
   * @returns {User} Updated user instance
   */
  async connectTwitter(twitterData) {
    this.twitterId = twitterData.twitterId;
    this.twitterUsername = twitterData.username;
    this.twitterToken = twitterData.accessToken;
    this.twitterTokenSecret = twitterData.accessSecret || null;
    this.twitterRefreshToken = twitterData.refreshToken || null;
    this.twitterTokenExpiresAt = twitterData.expiresAt ? 
      new Date(twitterData.expiresAt).toISOString() : null;
    
    this.twitterConnected = true;
    this.twitterConnectedAt = new Date().toISOString();
    this.isVerified = true; // Mark user as verified when they connect Twitter
    
    logger.info(`Connected Twitter account for user: ${this.telegramId} (Twitter: @${this.twitterUsername})`);
    
    return await this.save();
  }
  
  /**
   * Connect Sui wallet
   * @param {string} walletAddress - Sui wallet address
   * @param {boolean} isGenerated - Whether wallet was generated by bot
   * @returns {User} Updated user instance
   */
  async connectSuiWallet(walletAddress, isGenerated = false) {
    this.suiWalletAddress = walletAddress;
    this.suiWalletConnected = true;
    this.suiWalletConnectedAt = new Date().toISOString();
    this.suiWalletGenerated = isGenerated;
    
    logger.info(`Connected Sui wallet for user: ${this.telegramId} (Wallet: ${walletAddress})`);
    
    return await this.save();
  }
  
  /**
   * Check if user has connected their Twitter account
   * @returns {boolean} True if Twitter is connected
   */
  hasTwitterConnected() {
    return this.twitterConnected && !!this.twitterToken;
  }
  
  /**
   * Check if user has connected their Sui wallet
   * @returns {boolean} True if Sui wallet is connected
   */
  hasSuiWalletConnected() {
    return this.suiWalletConnected && !!this.suiWalletAddress;
  }
  
  /**
   * Check if user is eligible for a raid or campaign
   * @param {Object} requirements - Eligibility requirements
   * @returns {Object} Eligibility result {eligible, reasons}
   */
  checkEligibility(requirements = {}) {
    const reasons = [];
    
    // Check if verification is required
    if (requirements.requireVerification && !this.isVerified) {
      reasons.push('You need to verify your account by connecting your Twitter account');
    }
    
    // Check if Twitter connection is required
    if (requirements.requireTwitter && !this.hasTwitterConnected()) {
      reasons.push('You need to connect your Twitter account');
    }
    
    // Check if Sui wallet is required
    if (requirements.requireWallet && !this.hasSuiWalletConnected()) {
      reasons.push('You need to connect your Sui wallet');
    }
    
    // Check minimum XP if specified
    if (requirements.minXp && this.totalXp < requirements.minXp) {
      reasons.push(`You need at least ${requirements.minXp} XP (you have ${this.totalXp})`);
    }
    
    // Check minimum Twitter age if specified
    if (requirements.minTwitterAge && this.twitterConnectedAt) {
      const twitterAge = new Date() - new Date(this.twitterConnectedAt);
      const minAgeMs = requirements.minTwitterAge * 24 * 60 * 60 * 1000; // days to ms
      
      if (twitterAge < minAgeMs) {
        const daysRequired = requirements.minTwitterAge;
        const daysHave = Math.floor(twitterAge / (24 * 60 * 60 * 1000));
        reasons.push(`Your Twitter account needs to be connected for at least ${daysRequired} days (you have ${daysHave})`);
      }
    }
    
    return {
      eligible: reasons.length === 0,
      reasons
    };
  }
  
  /**
   * Get user's formatted name for display
   * @returns {string} Formatted name
   */
  getDisplayName() {
    if (this.username) {
      return `@${this.username}`;
    }
    
    if (this.firstName) {
      if (this.lastName) {
        return `${this.firstName} ${this.lastName}`;
      }
      return this.firstName;
    }
    
    return `User${this.telegramId}`;
  }
  
  /**
   * Get top users by total XP
   * @param {number} limit - Maximum number of users to return
   * @returns {Array<User>} Array of User instances
   */
  static async getTopByXp(limit = 10) {
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('total_xp', { ascending: false })
        .limit(limit);
      
      if (error) throw error;
      
      return data.map(userData => new User(userData));
    } catch (error) {
      logger.error('Error getting top users by XP:', error.message);
      return [];
    }
  }
  
  /**
   * Get user's XP rank among all users
   * @returns {number} User's rank (1-based)
   */
  async getXpRank() {
    try {
      const supabase = getSupabase();
      
      // Count users with more XP than this user
      const { count, error } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gt('total_xp', this.totalXp);
      
      if (error) throw error;
      
      // Rank is the count of users with more XP + 1
      return count + 1;
    } catch (error) {
      logger.error('Error getting user XP rank:', error.message);
      return null;
    }
  }
}

module.exports = User;