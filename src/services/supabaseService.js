/**
 * Supabase Service
 * Handles database connection and operations with Supabase
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

// Initialize Supabase client
let supabase = null;

/**
 * Connect to Supabase and initialize tables if needed
 */
const connectToSupabase = async () => {
  try {
    // Check if required environment variables are set
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_KEY must be defined in .env file');
    }
    
    logger.info(`Connecting to Supabase at ${process.env.SUPABASE_URL.split('//')[1].split('.')[0]}...`);

    // Create Supabase client
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      // Set reasonable timeouts
      global: {
        fetch: (url, options) => {
          return fetch(url, {
            ...options,
            timeout: 30000, // 30 seconds timeout
          });
        },
      },
    });
    
    // Test connection with a simple query
    logger.info('Testing Supabase connection...');
    
    try {
      const { data, error } = await supabase.from('users').select('count');
      
      if (error) {
        throw error;
      }
      
      logger.info('Supabase connection test successful, tables exist');
    } catch (error) {
      // If tables don't exist, try to initialize
      if (error.code === '42P01' || (error.message && (error.message.includes('relation') && error.message.includes('does not exist')))) {
        logger.info('Database tables not found. Attempting to initialize database...');
        await initializeDatabase();
      } else {
        // Log the error but don't throw, to allow bot to function without DB temporarily
        logger.error(`Supabase query test failed: ${error.message}`);
        logger.warn('Continuing without confirmed database connection - some functionality may be limited');
      }
    }
    
    logger.info('Supabase connection established');
    return supabase;
  } catch (error) {
    logger.error(`Failed to connect to Supabase: ${error.message}`);
    // In production, we might want to exit, but in development we can continue with limited functionality
    if (process.env.NODE_ENV === 'production') {
      throw error; // Re-throw to crash in production
    } else {
      logger.warn('Continuing without database in development mode - most functionality will be limited');
      return null;
    }
  }
};

/**
 * Initialize database tables if they don't exist
 */
const initializeDatabase = async () => {
  try {
    logger.info('Creating database tables...');
    
    // Using raw SQL queries to create tables directly
    // This is generally safer than relying on RPC which might not be set up
    
    // Create users table
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        first_name TEXT,
        last_name TEXT,
        username TEXT,
        language_code TEXT,
        joined_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        is_verified BOOLEAN NOT NULL DEFAULT FALSE,
        total_xp INTEGER NOT NULL DEFAULT 0,
        twitter_id TEXT UNIQUE,
        twitter_username TEXT,
        twitter_token TEXT,
        twitter_token_secret TEXT,
        twitter_refresh_token TEXT,
        twitter_token_expires_at TIMESTAMPTZ,
        twitter_connected BOOLEAN NOT NULL DEFAULT FALSE,
        twitter_connected_at TIMESTAMPTZ,
        sui_wallet_address TEXT,
        sui_wallet_connected BOOLEAN NOT NULL DEFAULT FALSE,
        sui_wallet_connected_at TIMESTAMPTZ,
        sui_wallet_generated BOOLEAN NOT NULL DEFAULT FALSE
      );
    `;
    
    // Create raids table
    const createRaidsTable = `
      CREATE TABLE IF NOT EXISTS raids (
        id SERIAL PRIMARY KEY,
        tweet_id TEXT NOT NULL,
        tweet_url TEXT NOT NULL,
        admin_id BIGINT NOT NULL,
        chat_id BIGINT NOT NULL,
        start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        end_time TIMESTAMPTZ,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        target_likes INTEGER NOT NULL DEFAULT 0,
        target_retweets INTEGER NOT NULL DEFAULT 0,
        target_comments INTEGER NOT NULL DEFAULT 0,
        actual_likes INTEGER NOT NULL DEFAULT 0,
        actual_retweets INTEGER NOT NULL DEFAULT 0,
        actual_comments INTEGER NOT NULL DEFAULT 0,
        token_type TEXT,
        token_symbol TEXT,
        total_reward DECIMAL,
        token_per_xp DECIMAL,
        threshold_xp INTEGER NOT NULL DEFAULT 0,
        campaign_id INTEGER,
        status TEXT DEFAULT 'active',
        message_id BIGINT,
        duration INTEGER NOT NULL DEFAULT 3600,
        require_verification BOOLEAN NOT NULL DEFAULT TRUE,
        description TEXT,
        rewards_distributed BOOLEAN NOT NULL DEFAULT FALSE
      );
    `;
    
    // Create campaigns table
    const createCampaignsTable = `
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        admin_id BIGINT NOT NULL,
        chat_id BIGINT NOT NULL,
        start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        end_date TIMESTAMPTZ NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        token_type TEXT,
        token_symbol TEXT,
        total_budget DECIMAL,
        token_per_xp DECIMAL,
        threshold_xp INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        status TEXT DEFAULT 'active',
        rewards_distributed BOOLEAN NOT NULL DEFAULT FALSE
      );
    `;
    
    // Create user_actions table
    const createUserActionsTable = `
      CREATE TABLE IF NOT EXISTS user_actions (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        raid_id INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        xp_earned INTEGER NOT NULL DEFAULT 0,
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        comment_text TEXT,
        comment_has_media BOOLEAN NOT NULL DEFAULT FALSE,
        twitter_action_id TEXT,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    
    // Create XP transactions table
    const createXpTransactionsTable = `
      CREATE TABLE IF NOT EXISTS xp_transactions (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        previous_total INTEGER NOT NULL DEFAULT 0,
        new_total INTEGER NOT NULL DEFAULT 0
      );
    `;
    
    // Create analytics table
    const createAnalyticsTable = `
      CREATE TABLE IF NOT EXISTS analytics (
        id SERIAL PRIMARY KEY,
        message_id BIGINT,
        chat_id BIGINT NOT NULL,
        chat_type TEXT NOT NULL,
        user_id BIGINT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        message_type TEXT NOT NULL
      );
    `;
    
    // Create group_admins table
    const createGroupAdminsTable = `
      CREATE TABLE IF NOT EXISTS group_admins (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL,
        chat_id BIGINT NOT NULL,
        added_by BIGINT NOT NULL,
        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(telegram_id, chat_id)
      );
    `;
    
    // Create twitter_accounts table for additional Twitter info
    const createTwitterAccountsTable = `
      CREATE TABLE IF NOT EXISTS twitter_accounts (
        id SERIAL PRIMARY KEY,
        twitter_id TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        name TEXT,
        created_at TIMESTAMPTZ,
        followers_count INTEGER NOT NULL DEFAULT 0,
        following_count INTEGER NOT NULL DEFAULT 0,
        tweet_count INTEGER NOT NULL DEFAULT 0,
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        telegram_id BIGINT NOT NULL,
        last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    
    // Execute all table creation queries
    try {
      // We'll use raw query since it's more reliable than RPC for table creation
      await supabase.rpc('exec_sql', { sql: createUsersTable });
      logger.info('Users table created or already exists');
    } catch (error) {
      // Fallback to direct query if RPC not available
      if (error.message?.includes('function') && error.message?.includes('does not exist')) {
        const { error: directError } = await supabase.auth.admin.executeRaw(createUsersTable);
        if (directError && !directError.message?.includes('already exists')) {
          logger.error(`Error creating users table: ${directError.message}`);
        } else {
          logger.info('Users table created or already exists');
        }
      } else if (!error.message?.includes('already exists')) {
        logger.error(`Error creating users table: ${error.message}`);
      } else {
        logger.info('Users table already exists');
      }
    }
    
    // Try to create the remaining tables the same way
    const tables = [
      { name: 'raids', sql: createRaidsTable },
      { name: 'campaigns', sql: createCampaignsTable },
      { name: 'user_actions', sql: createUserActionsTable },
      { name: 'xp_transactions', sql: createXpTransactionsTable },
      { name: 'analytics', sql: createAnalyticsTable },
      { name: 'group_admins', sql: createGroupAdminsTable },
      { name: 'twitter_accounts', sql: createTwitterAccountsTable }
    ];
    
    // Create each table
    for (const table of tables) {
      try {
        await supabase.rpc('exec_sql', { sql: table.sql });
        logger.info(`${table.name} table created or already exists`);
      } catch (error) {
        // Similar fallback approach
        if (error.message?.includes('function') && error.message?.includes('does not exist')) {
          logger.warn(`RPC not available, trying direct SQL for ${table.name}`);
          // Since we can't use direct SQL in most Supabase instances, we'll note this as a manual step
          logger.warn(`${table.name} table needs to be created manually in Supabase dashboard`);
        } else if (!error.message?.includes('already exists')) {
          logger.error(`Error creating ${table.name} table: ${error.message}`);
        } else {
          logger.info(`${table.name} table already exists`);
        }
      }
    }
    
    logger.info('Database initialization complete');
  } catch (error) {
    logger.error(`Error initializing database: ${error.message}`);
    throw error;
  }
};

/**
 * Get Supabase client instance
 */
const getSupabase = () => {
  if (!supabase) {
    logger.warn('Supabase client requested but not initialized');
    if (process.env.NODE_ENV === 'production') {
      // In production, this is a critical error
      logger.error('Supabase client not initialized in production. Call connectToSupabase() first.');
      return null;
    } else {
      // In development, we might try to reconnect
      logger.warn('Attempting to reconnect to Supabase...');
      try {
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
        logger.info('Reconnected to Supabase');
      } catch (error) {
        logger.error(`Failed to reconnect to Supabase: ${error.message}`);
        return null;
      }
    }
  }
  return supabase;
};

/**
 * Helper function to handle database errors consistently
 * @param {Error} error - The error object
 * @param {string} operation - The operation description
 * @returns {null} Returns null to help with error chaining
 */
const handleDatabaseError = (error, operation) => {
  logger.error(`Database error during ${operation}: ${error.message}`);
  // Return null instead of throwing - this helps prevent unhandled promise rejections
  return null;
};

// Export functions
module.exports = {
  connectToSupabase,
  getSupabase,
  handleDatabaseError
};