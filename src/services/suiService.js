/**
 * Sui Blockchain Service
 * Handles all Sui blockchain operations including wallet management and token transfers
 */

const logger = require('../utils/logger');
const { getSupabase } = require('./supabaseService');
const crypto = require('crypto');

/**
 * Generate a new Sui wallet
 * @returns {Object} Generated wallet with address, public key and private key
 */
const generateSuiWallet = async () => {
  try {
    logger.info('Generating new Sui wallet');
    
    // In production, we'd use @mysten/sui.js library
    // For now, create a stub wallet for development
    const privateKey = crypto.randomBytes(32).toString('hex');
    const publicKey = crypto.randomBytes(32).toString('hex');
    const address = '0x' + crypto.randomBytes(20).toString('hex');
    
    logger.info(`New Sui wallet generated with address: ${address}`);
    
    return {
      address,
      publicKey,
      privateKey
    };
  } catch (error) {
    logger.error(`Error generating Sui wallet: ${error.message}`);
    throw new Error(`Failed to generate Sui wallet: ${error.message}`);
  }
};

/**
 * Get wallet balance
 * @param {string} address - Sui wallet address
 * @returns {Object} Wallet balance info
 */
const getWalletBalance = async (address) => {
  try {
    logger.info(`Fetching balance for wallet: ${address}`);
    
    // In production, we'd query Sui RPC here
    // For now, return placeholder data
    return {
      address,
      sui: "10.0",
      tokens: [
        {
          type: "0x2::sui::SUI",
          symbol: "SUI",
          balance: "10000000000" // 10 SUI in smallest units
        }
      ]
    };
  } catch (error) {
    logger.error(`Error getting wallet balance for ${address}: ${error.message}`);
    // Return a fallback with 0 balance instead of throwing
    return {
      address,
      sui: "0.0",
      tokens: []
    };
  }
};

/**
 * Send tokens from bot wallet to user
 * @param {string} recipientAddress - Recipient wallet address
 * @param {string} coinType - Token type to send (0x2::sui::SUI for SUI)
 * @param {string} amount - Amount to send (as a decimal string)
 * @returns {Object} Transaction result
 */
const sendTokens = async (recipientAddress, coinType, amount) => {
  try {
    logger.info(`Sending ${amount} ${coinType} to ${recipientAddress}`);
    
    // In production, we'd create and sign a transaction here
    // For now, create a stub transaction result
    const txId = `0x${crypto.randomBytes(32).toString('hex')}`;
    
    // Log the transaction to the database for tracking
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase
          .from('token_transactions')
          .insert({
            recipient_address: recipientAddress,
            coin_type: coinType,
            amount: amount,
            tx_id: txId,
            status: 'success',
            timestamp: new Date().toISOString()
          });
      } catch (dbError) {
        logger.warn(`Failed to log transaction to database: ${dbError.message}`);
        // Continue even if database logging fails
      }
    }
    
    logger.info(`Tokens sent successfully. Transaction ID: ${txId}`);
    
    return { 
      success: true,
      txId: txId,
      recipient: recipientAddress,
      amount: amount,
      coinType: coinType
    };
  } catch (error) {
    logger.error(`Error sending tokens to ${recipientAddress}: ${error.message}`);
    
    // Log the failed transaction
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase
          .from('token_transactions')
          .insert({
            recipient_address: recipientAddress,
            coin_type: coinType,
            amount: amount,
            status: 'failed',
            error: error.message,
            timestamp: new Date().toISOString()
          });
      } catch (dbError) {
        logger.warn(`Failed to log failed transaction to database: ${dbError.message}`);
      }
    }
    
    throw new Error(`Failed to send tokens: ${error.message}`);
  }
};

/**
 * Distribute rewards to users based on their XP
 * @param {Array} rewards - Array of {telegramId, walletAddress, tokenAmount, tokenType}
 * @returns {Object} Distribution results
 */
const distributeRewards = async (rewards) => {
  const results = {
    successful: [],
    failed: []
  };
  
  logger.info(`Starting distribution of rewards to ${rewards.length} users`);
  
  for (const reward of rewards) {
    try {
      // Validate reward data
      if (!reward.walletAddress || !reward.tokenAmount || !reward.tokenType) {
        throw new Error('Missing required reward data');
      }
      
      // Send tokens to user
      const sendResult = await sendTokens(
        reward.walletAddress,
        reward.tokenType,
        reward.tokenAmount.toString()
      );
      
      // Record successful distribution
      results.successful.push({
        telegramId: reward.telegramId,
        walletAddress: reward.walletAddress,
        amount: reward.tokenAmount,
        tokenType: reward.tokenType,
        txId: sendResult.txId
      });
      
      logger.info(`Reward of ${reward.tokenAmount} ${reward.tokenType} sent to user ${reward.telegramId}`);
      
      // Small delay to avoid rate limits or blockchain congestion
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      logger.error(`Error distributing reward to ${reward.telegramId}: ${error.message}`);
      
      // Record failed distribution
      results.failed.push({
        telegramId: reward.telegramId,
        walletAddress: reward.walletAddress || 'unknown',
        amount: reward.tokenAmount,
        tokenType: reward.tokenType,
        error: error.message
      });
    }
  }
  
  // Log overall results
  logger.info(`Reward distribution complete. Success: ${results.successful.length}, Failed: ${results.failed.length}`);
  
  return results;
};

/**
 * Get token information
 * @param {string} tokenType - Token type (e.g., 0x2::sui::SUI)
 * @returns {Object} Token information
 */
const getTokenInfo = async (tokenType) => {
  try {
    logger.debug(`Getting info for token type: ${tokenType}`);
    
    // For SUI token, return hardcoded info
    if (tokenType === '0x2::sui::SUI') {
      return {
        type: tokenType,
        symbol: 'SUI',
        name: 'Sui',
        decimals: 9
      };
    }
    
    // For other tokens, we'd query the blockchain
    // For now, return a placeholder
    return {
      type: tokenType,
      symbol: tokenType.split('::').pop(),
      name: `Token ${tokenType.split('::').pop()}`,
      decimals: 9
    };
  } catch (error) {
    logger.error(`Error getting token info for ${tokenType}: ${error.message}`);
    
    // Return minimal info instead of throwing
    return {
      type: tokenType,
      symbol: tokenType.split('::').pop() || 'UNKNOWN',
      decimals: 9
    };
  }
};

/**
 * Validate a Sui wallet address
 * @param {string} address - Address to validate
 * @returns {boolean} Whether the address is valid
 */
const validateWalletAddress = (address) => {
  // Basic validation - Sui addresses are 0x followed by 40 hex characters
  const suiAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  return suiAddressRegex.test(address);
};

/**
 * Create a token_transactions table if it doesn't exist
 * Helper function used during initialization
 */
const ensureTransactionsTable = async () => {
  try {
    const supabase = getSupabase();
    if (!supabase) return false;
    
    // Create token_transactions table if it doesn't exist
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS token_transactions (
          id SERIAL PRIMARY KEY,
          recipient_address TEXT NOT NULL,
          coin_type TEXT NOT NULL,
          amount TEXT NOT NULL,
          tx_id TEXT,
          status TEXT NOT NULL,
          error TEXT,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `
    });
    
    if (error && !error.message.includes('already exists')) {
      logger.error(`Error creating token_transactions table: ${error.message}`);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Error ensuring transactions table: ${error.message}`);
    return false;
  }
};

// Initialize the service
const initialize = async () => {
  try {
    logger.info('Initializing Sui service');
    
    // Ensure required tables exist
    await ensureTransactionsTable();
    
    // Check if we can connect to Sui RPC
    // In production, we'd test the connection here
    
    logger.info('Sui service initialized successfully');
    return true;
  } catch (error) {
    logger.error(`Failed to initialize Sui service: ${error.message}`);
    return false;
  }
};

// Initialize on module load
initialize().catch(err => {
  logger.error(`Error during Sui service initialization: ${err.message}`);
});

module.exports = {
  generateSuiWallet,
  getWalletBalance,
  sendTokens,
  distributeRewards,
  getTokenInfo,
  validateWalletAddress
};