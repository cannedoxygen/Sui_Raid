/**
 * Sui Blockchain Service
 * Handles all Sui blockchain operations including wallet management and token transfers
 */

const { Ed25519Keypair, JsonRpcProvider, RawSigner, TransactionBlock } = require('@mysten/sui.js');
const { bcs, fromB64 } = require('@mysten/bcs');
const logger = require('../utils/logger');
const { getSupabase } = require('./supabaseService');

// Initialize Sui provider with RPC URL from environment variables
let provider = null;

/**
 * Initialize Sui provider
 * @returns {JsonRpcProvider} Sui JSON RPC provider
 */
const getProvider = () => {
  if (!provider) {
    if (!process.env.SUI_RPC_URL) {
      throw new Error('SUI_RPC_URL not defined in environment variables');
    }
    
    provider = new JsonRpcProvider(process.env.SUI_RPC_URL);
  }
  
  return provider;
};

/**
 * Generate a new Sui wallet
 * @returns {Object} Wallet keypair and address
 */
const generateSuiWallet = () => {
  try {
    // Create a new Ed25519 keypair
    const keypair = Ed25519Keypair.generate();
    
    // Get the public key as a base64 string
    const publicKeyBase64 = fromB64(keypair.getPublicKey().toBytes());
    
    // Get the SUI address in base64 format
    const address = keypair.getPublicKey().toSuiAddress();
    
    // Export the private key for secure storage
    const privateKeyBase64 = keypair.export().privateKey;
    
    return {
      address,
      publicKey: publicKeyBase64,
      privateKey: privateKeyBase64
    };
  } catch (error) {
    logger.error('Error generating Sui wallet:', error.message);
    throw new Error('Failed to generate Sui wallet');
  }
};

/**
 * Get wallet balance
 * @param {string} address - Sui wallet address
 * @returns {Object} Wallet balance info
 */
const getWalletBalance = async (address) => {
  try {
    const provider = getProvider();
    
    // Get all coins owned by the address
    const { data: coins } = await provider.getAllCoins({
      owner: address
    });
    
    // Calculate SUI balance
    let suiBalance = 0n;
    let otherTokens = [];
    
    for (const coin of coins) {
      if (coin.coinType === '0x2::sui::SUI') {
        suiBalance += BigInt(coin.balance);
      } else {
        // Group other tokens by type
        const existingToken = otherTokens.find(t => t.type === coin.coinType);
        if (existingToken) {
          existingToken.balance = (BigInt(existingToken.balance) + BigInt(coin.balance)).toString();
        } else {
          // Fetch coin metadata to get symbol if available
          try {
            const metadata = await provider.getCoinMetadata({
              coinType: coin.coinType
            });
            
            otherTokens.push({
              type: coin.coinType,
              symbol: metadata?.symbol || 'Unknown',
              balance: coin.balance,
              decimals: metadata?.decimals || 9
            });
          } catch {
            // If metadata fetch fails, just add with unknown symbol
            otherTokens.push({
              type: coin.coinType,
              symbol: 'Unknown',
              balance: coin.balance,
              decimals: 9
            });
          }
        }
      }
    }
    
    // Format SUI balance to show as a decimal number
    const formattedSuiBalance = formatBalance(suiBalance, 9);
    
    return {
      address,
      sui: formattedSuiBalance,
      tokens: otherTokens.map(token => ({
        ...token,
        balance: formatBalance(BigInt(token.balance), token.decimals)
      }))
    };
  } catch (error) {
    logger.error('Error getting wallet balance:', error.message);
    throw new Error('Failed to fetch wallet balance');
  }
};

/**
 * Format a BigInt balance to a decimal string with proper precision
 * @param {BigInt} balance - Raw balance
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted balance
 */
const formatBalance = (balance, decimals) => {
  const divisor = 10n ** BigInt(decimals);
  const integerPart = balance / divisor;
  const fractionalPart = balance % divisor;
  
  // Pad the fractional part with leading zeros if needed
  const fractionalString = fractionalPart.toString().padStart(decimals, '0');
  
  // Trim trailing zeros
  const trimmedFractional = fractionalString.replace(/0+$/, '');
  
  if (trimmedFractional === '') {
    return integerPart.toString();
  }
  
  return `${integerPart}.${trimmedFractional}`;
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
    const provider = getProvider();
    
    // Get the bot wallet's private key from environment
    if (!process.env.SUI_WALLET_PRIVATE_KEY) {
      throw new Error('SUI_WALLET_PRIVATE_KEY not defined in environment variables');
    }
    
    // Create keypair from private key
    const keypair = Ed25519Keypair.fromSecretKey(
      Buffer.from(process.env.SUI_WALLET_PRIVATE_KEY, 'base64')
    );
    
    // Create signer
    const signer = new RawSigner(keypair, provider);
    
    // Convert amount to MIST (smallest unit)
    const decimals = coinType === '0x2::sui::SUI' ? 9 : 
      await getTokenDecimals(coinType);
    const amountInSmallestUnit = convertToSmallestUnit(amount, decimals);
    
    // Create transaction block
    const txb = new TransactionBlock();
    
    // If token is SUI, use special splitCoins and transferObjects methods
    if (coinType === '0x2::sui::SUI') {
      const [coin] = txb.splitCoins(txb.gas, [txb.pure(amountInSmallestUnit)]);
      txb.transferObjects([coin], txb.pure(recipientAddress));
    } else {
      // For other tokens, try to find coins of that type and transfer
      const { data: coins } = await provider.getCoins({
        owner: keypair.getPublicKey().toSuiAddress(),
        coinType
      });
      
      if (coins.length === 0) {
        throw new Error(`No coins of type ${coinType} found in bot wallet`);
      }
      
      // Calculate which coins to use
      let selectedCoins = [];
      let selectedAmount = 0n;
      const targetAmount = BigInt(amountInSmallestUnit);
      
      for (const coin of coins) {
        selectedCoins.push(coin.coinObjectId);
        selectedAmount += BigInt(coin.balance);
        
        if (selectedAmount >= targetAmount) {
          break;
        }
      }
      
      if (selectedAmount < targetAmount) {
        throw new Error(`Insufficient balance of ${coinType} in bot wallet`);
      }
      
      // Build transaction to merge coins, split the amount, and transfer
      const mergedCoin = txb.mergeCoins(
        txb.object(selectedCoins[0]), 
        selectedCoins.slice(1).map(id => txb.object(id))
      );
      
      const [coin] = txb.splitCoins(mergedCoin, [txb.pure(amountInSmallestUnit)]);
      txb.transferObjects([coin], txb.pure(recipientAddress));
    }
    
    // Set gas budget
    txb.setGasBudget(process.env.SUI_GAS_BUDGET || 2000000);
    
    // Sign and execute transaction
    const result = await signer.signAndExecuteTransactionBlock({
      transactionBlock: txb,
      options: {
        showEffects: true,
        showEvents: true
      }
    });
    
    // Log transaction
    await logTransaction({
      txId: result.digest,
      sender: keypair.getPublicKey().toSuiAddress(),
      recipient: recipientAddress,
      coinType,
      amount,
      amountInSmallestUnit,
      status: result.effects.status.status,
      timestamp: new Date().toISOString()
    });
    
    return result;
  } catch (error) {
    logger.error('Error sending tokens:', error.message);
    throw new Error(`Failed to send tokens: ${error.message}`);
  }
};

/**
 * Get token decimals from its metadata
 * @param {string} coinType - Token type
 * @returns {number} Number of decimal places (default 9 if not found)
 */
const getTokenDecimals = async (coinType) => {
  try {
    const provider = getProvider();
    const metadata = await provider.getCoinMetadata({
      coinType
    });
    
    return metadata?.decimals || 9;
  } catch (error) {
    logger.warn(`Could not get decimals for ${coinType}, using default (9):`, error.message);
    return 9;
  }
};

/**
 * Convert decimal amount to smallest unit
 * @param {string} amount - Amount as decimal string
 * @param {number} decimals - Number of decimal places
 * @returns {string} Amount in smallest unit
 */
const convertToSmallestUnit = (amount, decimals) => {
  // Handle decimal point
  let [integerPart, fractionalPart = ''] = amount.toString().split('.');
  
  // Pad or truncate fractional part to correct number of decimals
  fractionalPart = fractionalPart.padEnd(decimals, '0').slice(0, decimals);
  
  // Combine integer and fractional parts
  const result = integerPart + fractionalPart;
  
  // Remove leading zeros
  return BigInt(result).toString();
};

/**
 * Log a transaction to the database
 * @param {Object} transactionData - Transaction data
 */
const logTransaction = async (transactionData) => {
  try {
    const supabase = getSupabase();
    
    const { error } = await supabase
      .from('transactions')
      .insert(transactionData);
      
    if (error) {
      logger.error('Error logging transaction to database:', error.message);
    }
  } catch (error) {
    logger.error('Error logging transaction:', error.message);
  }
};

/**
 * Distribute rewards to users based on their XP
 * @param {Array} rewards - Array of {telegramId, walletAddress, amount, tokenType}
 * @returns {Object} Distribution results
 */
const distributeRewards = async (rewards) => {
  const results = {
    successful: [],
    failed: []
  };
  
  for (const reward of rewards) {
    try {
      // Send tokens to user
      const result = await sendTokens(
        reward.walletAddress,
        reward.tokenType,
        reward.amount
      );
      
      // Record successful distribution
      results.successful.push({
        telegramId: reward.telegramId,
        amount: reward.amount,
        tokenType: reward.tokenType,
        txId: result.digest
      });
      
      // Log distribution in database
      await logRewardDistribution({
        telegramId: reward.telegramId,
        walletAddress: reward.walletAddress,
        amount: reward.amount,
        tokenType: reward.tokenType,
        txId: result.digest,
        raidId: reward.raidId,
        campaignId: reward.campaignId,
        xpAmount: reward.xpAmount,
        status: 'success',
        timestamp: new Date().toISOString()
      });
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      logger.error(`Error distributing reward to ${reward.telegramId}:`, error.message);
      
      // Record failed distribution
      results.failed.push({
        telegramId: reward.telegramId,
        amount: reward.amount,
        tokenType: reward.tokenType,
        error: error.message
      });
      
      // Log failed distribution
      await logRewardDistribution({
        telegramId: reward.telegramId,
        walletAddress: reward.walletAddress,
        amount: reward.amount,
        tokenType: reward.tokenType,
        raidId: reward.raidId,
        campaignId: reward.campaignId,
        xpAmount: reward.xpAmount,
        status: 'failed',
        errorMessage: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  return results;
};

/**
 * Log a reward distribution to the database
 * @param {Object} distributionData - Distribution data
 */
const logRewardDistribution = async (distributionData) => {
  try {
    const supabase = getSupabase();
    
    const { error } = await supabase
      .from('reward_distributions')
      .insert(distributionData);
      
    if (error) {
      logger.error('Error logging reward distribution to database:', error.message);
    }
  } catch (error) {
    logger.error('Error logging reward distribution:', error.message);
  }
};

module.exports = {
  generateSuiWallet,
  getWalletBalance,
  sendTokens,
  distributeRewards
};