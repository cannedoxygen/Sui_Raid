/**
 * User Service
 * Handles all user-related operations
 */

const logger = require('../utils/logger');
const { getSupabase, handleDatabaseError } = require('./supabaseService');

/**
 * Get user by Telegram ID
 * @param {number} telegramId - Telegram user ID
 * @returns {Object|null} User object or null if not found
 */
const getUserById = async (telegramId) => {
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
      logger.error('Error in getUserById:', error.message);
      return null; // Return null instead of throwing
    }
    
    return data;
  } catch (error) {
    logger.error('Error getting user by ID:', error.message);
    return null; // Return null instead of throwing
  }
};

/**
 * Create a new user if they don't exist already
 * @param {Object} userData - User data to create
 * @returns {Object} Created or updated user
 */
const createUserIfNotExists = async (userData) => {
  try {
    const supabase = getSupabase();
    const { telegramId, firstName, lastName, username, languageCode, lastActive } = userData;
    
    // Check if user exists
    const existingUser = await getUserById(telegramId);
    
    if (existingUser) {
      logger.debug(`User exists, updating: ${telegramId}`);
      // Update last active timestamp
      const { data, error } = await supabase
        .from('users')
        .update({ 
          last_active: lastActive,
          // Update other fields that might have changed
          first_name: firstName || existingUser.first_name,
          last_name: lastName || existingUser.last_name,
          username: username || existingUser.username,
          language_code: languageCode || existingUser.language_code
        })
        .eq('telegram_id', telegramId)
        .select()
        .single();
        
      if (error) {
        logger.error('Error updating user:', error.message);
        return existingUser; // Return existing user on error
      }
      
      return data;
    }
    
    // If user doesn't exist, create new user
    logger.info(`Creating new user: ${telegramId} (${username || 'no username'})`);
    const { data, error } = await supabase
      .from('users')
      .insert({
        telegram_id: telegramId,
        first_name: firstName,
        last_name: lastName,
        username: username,
        language_code: languageCode,
        joined_date: new Date().toISOString(),
        last_active: lastActive,
        is_admin: false,
        is_verified: false,
        total_xp: 0,
        twitter_connected: false,
        sui_wallet_connected: false
      })
      .select()
      .single();
      
    if (error) {
      // If duplicate key error, try to fetch the existing user
      if (error.message && error.message.includes('duplicate key')) {
        logger.warn(`Tried to create duplicate user: ${telegramId}, fetching instead`);
        return await getUserById(telegramId);
      }
      
      logger.error('Error creating user:', error.message);
      // Create a simple user object to return instead of throwing
      return {
        telegram_id: telegramId,
        first_name: firstName,
        last_name: lastName,
        username: username
      };
    }
    
    return data;
  } catch (error) {
    logger.error('Error creating/updating user:', error.message);
    // Return a basic user object as fallback
    return {
      telegram_id: userData.telegramId,
      first_name: userData.firstName,
      last_name: userData.lastName,
      username: userData.username
    };
  }
};

/**
 * Link Twitter account to user
 * @param {number} telegramId - Telegram user ID
 * @param {Object} twitterData - Twitter account data
 * @returns {Object} Updated user
 */
const linkTwitterAccount = async (telegramId, twitterData) => {
  try {
    const supabase = getSupabase();
    const { twitterId, username, accessToken, refreshToken, expiresAt } = twitterData;
    
    const { data, error } = await supabase
      .from('users')
      .update({
        twitter_id: twitterId,
        twitter_username: username,
        twitter_token: accessToken,
        twitter_refresh_token: refreshToken,
        twitter_token_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        twitter_connected: true,
        twitter_connected_at: new Date().toISOString(),
        is_verified: true // Mark user as verified when they connect Twitter
      })
      .eq('telegram_id', telegramId)
      .select()
      .single();
      
    if (error) {
      logger.error('Error linking Twitter account:', error.message);
      return null;
    }
    
    logger.info(`Twitter account linked for user: ${telegramId} (Twitter: @${username})`);
    return data;
  } catch (error) {
    logger.error('Error linking Twitter account:', error.message);
    return null;
  }
};

/**
 * Link Sui wallet to user
 * @param {number} telegramId - Telegram user ID
 * @param {string} walletAddress - Sui wallet address
 * @param {boolean} isGenerated - Whether wallet was generated by bot
 * @returns {Object} Updated user
 */
const linkSuiWallet = async (telegramId, walletAddress, isGenerated = false) => {
  try {
    const supabase = getSupabase();
    
    const { data, error } = await supabase
      .from('users')
      .update({
        sui_wallet_address: walletAddress,
        sui_wallet_connected: true,
        sui_wallet_connected_at: new Date().toISOString(),
        sui_wallet_generated: isGenerated
      })
      .eq('telegram_id', telegramId)
      .select()
      .single();
      
    if (error) {
      logger.error('Error linking Sui wallet:', error.message);
      return null;
    }
    
    logger.info(`Sui wallet linked for user: ${telegramId} (Wallet: ${walletAddress})`);
    return data;
  } catch (error) {
    logger.error('Error linking Sui wallet:', error.message);
    return null;
  }
};

/**
 * Check if user is admin in a specific group
 * @param {number} telegramId - Telegram user ID
 * @param {number} chatId - Telegram chat ID
 * @returns {boolean} True if user is admin
 */
const isUserAdminInGroup = async (telegramId, chatId) => {
  try {
    const supabase = getSupabase();
    
    // Check if user is a global admin in our system
    const user = await getUserById(telegramId);
    if (user && user.is_admin) {
      return true;
    }
    
    // Check if user is an admin in this specific group
    const { data, error } = await supabase
      .from('group_admins')
      .select('*')
      .eq('telegram_id', telegramId)
      .eq('chat_id', chatId)
      .single();
      
    if (error) {
      // If no rows returned, user is not an admin
      if (error.code === 'PGRST116') {
        return false;
      }
      logger.error('Error checking admin status:', error.message);
      return false;
    }
    
    return data ? true : false;
  } catch (error) {
    logger.error('Error checking admin status:', error.message);
    return false; // Default to not admin on error
  }
};

/**
 * Add XP to user
 * @param {number} telegramId - Telegram user ID
 * @param {number} xpAmount - Amount of XP to add
 * @param {string} source - Source of XP (raid, etc.)
 * @param {number} sourceId - ID of the source (raid ID, etc.)
 * @returns {Object} Updated user with new XP total
 */
const addUserXp = async (telegramId, xpAmount, source, sourceId) => {
  try {
    // Start a transaction
    const supabase = getSupabase();
    
    // 1. Get current user XP
    const user = await getUserById(telegramId);
    if (!user) {
      logger.error('User not found for XP addition:', telegramId);
      return null;
    }
    
    const newTotalXp = (user.total_xp || 0) + xpAmount;
    
    // 2. Update user's total XP
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({
        total_xp: newTotalXp,
        last_xp_earned_at: new Date().toISOString()
      })
      .eq('telegram_id', telegramId)
      .select()
      .single();
      
    if (updateError) {
      logger.error('Error updating user XP:', updateError.message);
      return user; // Return original user on error
    }
    
    // 3. Log XP transaction
    const { error: logError } = await supabase
      .from('xp_transactions')
      .insert({
        user_id: telegramId,
        amount: xpAmount,
        source_type: source,
        source_id: sourceId,
        timestamp: new Date().toISOString(),
        previous_total: user.total_xp || 0,
        new_total: newTotalXp
      });
      
    if (logError) {
      logger.warn('Error logging XP transaction:', logError.message);
      // Continue even if logging fails
    }
    
    logger.info(`Added ${xpAmount} XP to user ${telegramId}, new total: ${newTotalXp}`);
    return updatedUser;
  } catch (error) {
    logger.error('Error adding XP to user:', error.message);
    return null;
  }
};

/**
 * Get user's XP for a specific campaign or raid
 * @param {number} telegramId - Telegram user ID
 * @param {string} sourceType - Source type ('raid' or 'campaign')
 * @param {number} sourceId - ID of the raid or campaign
 * @returns {number} Total XP for that source
 */
const getUserXpForSource = async (telegramId, sourceType, sourceId) => {
  try {
    const supabase = getSupabase();
    
    const { data, error } = await supabase
      .from('xp_transactions')
      .select('amount')
      .eq('user_id', telegramId)
      .eq('source_type', sourceType)
      .eq('source_id', sourceId);
      
    if (error) {
      logger.error('Error getting user XP for source:', error.message);
      return 0;
    }
    
    // Sum up all XP from this source
    const totalXp = data.reduce((sum, record) => sum + record.amount, 0);
    return totalXp;
  } catch (error) {
    logger.error('Error getting user XP for source:', error.message);
    return 0; // Default to 0 on error
  }
};

module.exports = {
  getUserById,
  createUserIfNotExists,
  linkTwitterAccount,
  linkSuiWallet,
  isUserAdminInGroup,
  addUserXp,
  getUserXpForSource
};