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
    
    // If Supabase is not connected, return null
    if (!supabase) {
      logger.error(`Cannot get user ${telegramId}: Supabase is not connected`);
      return null;
    }
    
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();
      
    if (error) {
      // If no rows returned, user doesn't exist
      if (error.code === 'PGRST116') {
        logger.debug(`User ${telegramId} not found in database`);
        return null;
      }
      logger.error(`Error in getUserById for ${telegramId}: ${error.message}`);
      return null; // Return null instead of throwing
    }
    
    logger.debug(`User ${telegramId} found in database`);
    return data;
  } catch (error) {
    logger.error(`Error getting user by ID ${telegramId}: ${error.message}`);
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
    
    // If Supabase is not connected, return a simple user object
    if (!supabase) {
      logger.error('Cannot create user: Supabase is not connected');
      return {
        telegram_id: userData.telegramId,
        first_name: userData.firstName,
        last_name: userData.lastName,
        username: userData.username
      };
    }
    
    const { telegramId, firstName, lastName, username, languageCode, lastActive } = userData;
    
    // Check if user exists
    const existingUser = await getUserById(telegramId);
    
    if (existingUser) {
      logger.debug(`User exists, updating: ${telegramId}`);
      // Update last active timestamp and other fields that might have changed
      const { data, error } = await supabase
        .from('users')
        .update({ 
          last_active: lastActive || new Date().toISOString(),
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
        logger.error(`Error updating user ${telegramId}: ${error.message}`);
        return existingUser; // Return existing user on error
      }
      
      logger.debug(`User ${telegramId} updated successfully`);
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
        last_active: lastActive || new Date().toISOString(),
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
      
      logger.error(`Error creating user ${telegramId}: ${error.message}`);
      // Create a simple user object to return instead of throwing
      return {
        telegram_id: telegramId,
        first_name: firstName,
        last_name: lastName,
        username: username
      };
    }
    
    logger.info(`User ${telegramId} created successfully`);
    return data;
  } catch (error) {
    logger.error(`Error creating/updating user ${userData.telegramId}: ${error.message}`);
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
    
    // If Supabase is not connected, return null
    if (!supabase) {
      logger.error(`Cannot link Twitter account for user ${telegramId}: Supabase is not connected`);
      return null;
    }
    
    const { twitterId, username, accessToken, refreshToken, expiresAt } = twitterData;
    
    // Validate required fields
    if (!twitterId || !username || !accessToken) {
      logger.error(`Invalid Twitter data for user ${telegramId}`);
      return null;
    }
    
    logger.info(`Linking Twitter account @${username} for user ${telegramId}`);
    
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
      logger.error(`Error linking Twitter account for user ${telegramId}: ${error.message}`);
      return null;
    }
    
    logger.info(`Twitter account linked successfully for user ${telegramId} (Twitter: @${username})`);
    return data;
  } catch (error) {
    logger.error(`Error linking Twitter account for user ${telegramId}: ${error.message}`);
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
    
    // If Supabase is not connected, return null
    if (!supabase) {
      logger.error(`Cannot link Sui wallet for user ${telegramId}: Supabase is not connected`);
      return null;
    }
    
    // Validate wallet address (basic validation)
    if (!walletAddress || !walletAddress.startsWith('0x') || walletAddress.length < 10) {
      logger.error(`Invalid Sui wallet address for user ${telegramId}: ${walletAddress}`);
      return null;
    }
    
    logger.info(`Linking Sui wallet ${walletAddress} for user ${telegramId}`);
    
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
      logger.error(`Error linking Sui wallet for user ${telegramId}: ${error.message}`);
      return null;
    }
    
    logger.info(`Sui wallet linked successfully for user ${telegramId} (Wallet: ${walletAddress})`);
    return data;
  } catch (error) {
    logger.error(`Error linking Sui wallet for user ${telegramId}: ${error.message}`);
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
    
    // If Supabase is not connected, assume not admin
    if (!supabase) {
      logger.error(`Cannot check admin status for user ${telegramId}: Supabase is not connected`);
      return false;
    }
    
    // Check if user is a global admin in our system
    const user = await getUserById(telegramId);
    if (user && user.is_admin) {
      logger.debug(`User ${telegramId} is a global admin`);
      return true;
    }
    
    // For development/testing, allow all users to be admins if flag is set
    if (process.env.DEV_ALL_ADMINS === 'true') {
      logger.debug(`DEV_ALL_ADMINS enabled, treating user ${telegramId} as admin`);
      return true;
    }
    
    // Check if user is an admin in this specific group
    const { data, error } = await supabase
      .from('group_admins')
      .select('*')
      .eq('telegram_id', telegramId)
      .eq('chat_id', chatId)
      .maybeSingle();
      
    if (error) {
      logger.error(`Error checking admin status for user ${telegramId} in chat ${chatId}: ${error.message}`);
      return false;
    }
    
    if (data) {
      logger.debug(`User ${telegramId} is an admin in chat ${chatId}`);
      return true;
    }
    
    // If user is not a registered admin, we could check Telegram's API for admin status
    // This would require calling bot.getChatMember(chatId, telegramId) and checking status
    // For now, we'll just return false
    logger.debug(`User ${telegramId} is not an admin in chat ${chatId}`);
    return false;
  } catch (error) {
    logger.error(`Error checking admin status for user ${telegramId} in chat ${chatId}: ${error.message}`);
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
    const supabase = getSupabase();
    
    // If Supabase is not connected, return null
    if (!supabase) {
      logger.error(`Cannot add XP for user ${telegramId}: Supabase is not connected`);
      return null;
    }
    
    // Get current user XP
    const user = await getUserById(telegramId);
    if (!user) {
      logger.error(`User ${telegramId} not found for XP addition`);
      return null;
    }
    
    const newTotalXp = (user.total_xp || 0) + xpAmount;
    logger.info(`Adding ${xpAmount} XP to user ${telegramId}, new total: ${newTotalXp}`);
    
    // Start a transaction using Supabase's functions
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
      logger.error(`Error updating user ${telegramId} XP: ${updateError.message}`);
      return user; // Return original user on error
    }
    
    // Log XP transaction
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
      logger.warn(`Error logging XP transaction for user ${telegramId}: ${logError.message}`);
      // Continue even if logging fails
    }
    
    logger.info(`Successfully added ${xpAmount} XP to user ${telegramId}, new total: ${newTotalXp}`);
    return updatedUser;
  } catch (error) {
    logger.error(`Error adding XP to user ${telegramId}: ${error.message}`);
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
    
    // If Supabase is not connected, return 0
    if (!supabase) {
      logger.error(`Cannot get XP for user ${telegramId}: Supabase is not connected`);
      return 0;
    }
    
    const { data, error } = await supabase
      .from('xp_transactions')
      .select('amount')
      .eq('user_id', telegramId)
      .eq('source_type', sourceType)
      .eq('source_id', sourceId);
      
    if (error) {
      logger.error(`Error getting user ${telegramId} XP for source ${sourceType}:${sourceId}: ${error.message}`);
      return 0;
    }
    
    // Sum up all XP from this source
    const totalXp = data.reduce((sum, record) => sum + record.amount, 0);
    logger.debug(`User ${telegramId} has ${totalXp} XP from source ${sourceType}:${sourceId}`);
    return totalXp;
  } catch (error) {
    logger.error(`Error getting user ${telegramId} XP for source: ${error.message}`);
    return 0; // Default to 0 on error
  }
};

/**
 * Set user as admin
 * @param {number} telegramId - Telegram user ID
 * @param {boolean} isAdmin - Admin status to set
 * @returns {Object} Updated user
 */
const setUserAdmin = async (telegramId, isAdmin = true) => {
  try {
    const supabase = getSupabase();
    
    // If Supabase is not connected, return null
    if (!supabase) {
      logger.error(`Cannot set admin status for user ${telegramId}: Supabase is not connected`);
      return null;
    }
    
    logger.info(`Setting user ${telegramId} admin status to: ${isAdmin}`);
    
    const { data, error } = await supabase
      .from('users')
      .update({
        is_admin: isAdmin
      })
      .eq('telegram_id', telegramId)
      .select()
      .single();
      
    if (error) {
      logger.error(`Error setting admin status for user ${telegramId}: ${error.message}`);
      return null;
    }
    
    logger.info(`User ${telegramId} admin status updated to: ${isAdmin}`);
    return data;
  } catch (error) {
    logger.error(`Error setting admin status for user ${telegramId}: ${error.message}`);
    return null;
  }
};

/**
 * Add user as admin to a specific group
 * @param {number} telegramId - Telegram user ID
 * @param {number} chatId - Telegram chat ID
 * @param {number} addedBy - Telegram ID of admin who added them
 * @returns {boolean} Success status
 */
const addGroupAdmin = async (telegramId, chatId, addedBy) => {
  try {
    const supabase = getSupabase();
    
    // If Supabase is not connected, return false
    if (!supabase) {
      logger.error(`Cannot add group admin: Supabase is not connected`);
      return false;
    }
    
    logger.info(`Adding user ${telegramId} as admin in chat ${chatId} by ${addedBy}`);
    
    const { error } = await supabase
      .from('group_admins')
      .insert({
        telegram_id: telegramId,
        chat_id: chatId,
        added_by: addedBy,
        added_at: new Date().toISOString()
      });
      
    if (error) {
      // If unique constraint violation, admin already exists - not an error
      if (error.message && error.message.includes('unique constraint')) {
        logger.info(`User ${telegramId} is already an admin in chat ${chatId}`);
        return true;
      }
      
      logger.error(`Error adding user ${telegramId} as admin in chat ${chatId}: ${error.message}`);
      return false;
    }
    
    logger.info(`User ${telegramId} added as admin in chat ${chatId}`);
    return true;
  } catch (error) {
    logger.error(`Error adding group admin: ${error.message}`);
    return false;
  }
};

/**
 * Get top users by XP
 * @param {number} limit - Number of top users to retrieve
 * @returns {Array} Array of top users
 */
const getTopUsersByXp = async (limit = 10) => {
  try {
    const supabase = getSupabase();
    
    // If Supabase is not connected, return empty array
    if (!supabase) {
      logger.error('Cannot get top users: Supabase is not connected');
      return [];
    }
    
    const { data, error } = await supabase
      .from('users')
      .select('telegram_id, first_name, last_name, username, total_xp')
      .order('total_xp', { ascending: false })
      .limit(limit);
      
    if (error) {
      logger.error(`Error getting top users by XP: ${error.message}`);
      return [];
    }
    
    logger.debug(`Retrieved ${data.length} top users by XP`);
    return data;
  } catch (error) {
    logger.error(`Error getting top users: ${error.message}`);
    return [];
  }
};

module.exports = {
  getUserById,
  createUserIfNotExists,
  linkTwitterAccount,
  linkSuiWallet,
  isUserAdminInGroup,
  addUserXp,
  getUserXpForSource,
  setUserAdmin,
  addGroupAdmin,
  getTopUsersByXp
};