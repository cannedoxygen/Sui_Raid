/**
 * Configuration File
 * Centralizes all application settings and environment variables
 */

// Load environment variables if not already loaded
require('dotenv').config();

/**
 * Validate required environment variables
 * @param {Array} requiredVars - List of required environment variables
 * @throws {Error} If any required variables are missing
 */
const validateEnv = (requiredVars) => {
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Please check your .env file.'
    );
  }
};

// Validate critical environment variables
validateEnv([
  'TELEGRAM_BOT_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'SUI_RPC_URL',
  'TWITTER_API_KEY',
  'TWITTER_API_SECRET'
]);

// Base configuration
const config = {
  // Application
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  
  // Server configuration
  server: {
    // Port for Express server
    port: parseInt(process.env.PORT || '3000', 10),
    // Enable webhook in production when a valid URL (http/https) is provided
    webhookEnabled: process.env.NODE_ENV === 'production' && /^https?:\/\//i.test(process.env.WEBHOOK_URL || ''),
    // Normalize and validate webhook URL (must start with http(s)://); strip trailing slash and any /bot<token> suffix
    webhookUrl: (() => {
      const raw = process.env.WEBHOOK_URL || '';
      const trimmed = raw.trim();
      // Must be a valid HTTP(S) URL
      if (!/^https?:\/\//i.test(trimmed)) {
        return '';
      }
      let u = trimmed.replace(/\/+$/, '');
      // Remove appended bot token path if present
      const suffix = `/bot${process.env.TELEGRAM_BOT_TOKEN}`;
      if (suffix && u.endsWith(suffix)) {
        u = u.slice(0, -suffix.length);
      }
      return u;
    })()
  },
  
  // Telegram Bot configuration
  telegram: {
    // Bot token provided by Telegram
    token: process.env.TELEGRAM_BOT_TOKEN,
    // Webhook path suffix (appended to server.webhookUrl)
    webhookPath: process.env.WEBHOOK_URL 
      ? `/bot${process.env.TELEGRAM_BOT_TOKEN}` 
      : undefined,
    // Enable polling when no valid webhook is configured (for development/local)
    polling: !(process.env.NODE_ENV === 'production' && /^https?:\/\//i.test(process.env.WEBHOOK_URL || ''))
  },
  
  // Supabase Database
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY
  },
  
  // Twitter OAuth2 Client Credentials
  twitter: (() => {
    const clientId = process.env.TWITTER_CLIENT_ID || process.env.TWITTER_API_KEY;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET || process.env.TWITTER_API_SECRET;
    // Determine callback URL: honour override, support Vercel, with fallback
    let callbackUrl;
    if (process.env.NODE_ENV === 'production') {
      // 1) honour an explicit override
      if (process.env.TWITTER_CALLBACK_URL) {
        callbackUrl = process.env.TWITTER_CALLBACK_URL;
      }
      // 2) use Vercel serverless route if VERCEL_URL is set
      else if (process.env.VERCEL_URL) {
        callbackUrl = `https://${process.env.VERCEL_URL}/api/twitter/callback`;
      }
      // 3) fallback to your known prod domain
      else {
        callbackUrl = 'https://sui-raid.vercel.app/twitter/callback';
      }
    } else {
      callbackUrl = `http://localhost:${process.env.PORT || 3000}/twitter/callback`;
    }
    return {
      apiKey: clientId,
      apiSecret: clientSecret,
      callbackUrl
    };
  })(),
  
  // Sui Blockchain
  sui: {
    rpcUrl: process.env.SUI_RPC_URL,
    walletPrivateKey: process.env.SUI_WALLET_PRIVATE_KEY,
    gasBudget: parseInt(process.env.SUI_GAS_BUDGET || '2000000', 10),
    network: process.env.SUI_RPC_URL?.includes('devnet') ? 
      'devnet' : process.env.SUI_RPC_URL?.includes('testnet') ? 
      'testnet' : 'mainnet'
  },
  
  // XP System
  xp: {
    actions: {
      like: parseInt(process.env.XP_LIKE || '10', 10),
      retweet: parseInt(process.env.XP_RETWEET || '10', 10),
      comment: parseInt(process.env.XP_COMMENT || '15', 10),
      commentWithImage: parseInt(process.env.XP_COMMENT_IMAGE || '20', 10),
      commentWithGif: parseInt(process.env.XP_COMMENT_GIF || '25', 10),
      bookmark: parseInt(process.env.XP_BOOKMARK || '5', 10)
    },
    // Default threshold for campaigns
    defaultThreshold: parseInt(process.env.DEFAULT_XP_THRESHOLD || '1000', 10)
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
  },
  
  // Security
  security: {
    // Max age for OAuth states (1 hour)
    oauthStateMaxAge: parseInt(process.env.OAUTH_STATE_MAX_AGE || '3600000', 10)
  }
};

/**
 * Get configuration value by path
 * @param {string} path - Dot-notation path to configuration value
 * @param {any} defaultValue - Default value if path is not found
 * @returns {any} Configuration value
 */
const get = (path, defaultValue) => {
  const parts = path.split('.');
  let current = config;
  
  for (const part of parts) {
    if (current[part] === undefined) {
      return defaultValue;
    }
    current = current[part];
  }
  
  return current;
};

module.exports = {
  ...config,
  get
};