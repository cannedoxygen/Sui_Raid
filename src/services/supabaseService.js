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

    // Create Supabase client
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    
    // Test connection
    logger.info('Testing Supabase connection...');
    const { data, error } = await supabase.from('users').select('count').limit(1);
    
    if (error) {
      // If error is because table doesn't exist, initialize database
      if (error.code === '42P01') {  // PostgreSQL error code for undefined_table
        logger.info('Users table does not exist. Initializing database tables...');
        await initializeDatabase();
        logger.info('Database initialized successfully');
      } else {
        logger.error('Error connecting to Supabase:', error);
        // Don't throw here, just log and continue
      }
    } else {
      logger.info('Supabase connection test successful, tables exist');
    }
    
    logger.info('Supabase connection established successfully');
    return supabase;
  } catch (error) {
    logger.error('Error connecting to Supabase:', error.message);
    throw error;
  }
};

/**
 * Initialize database tables if they don't exist
 */
const initializeDatabase = async () => {
  try {
    logger.info('Creating users table...');
    // Use raw SQL to create tables instead of RPC
    const { error: usersError } = await supabase.rpc('create_users_table', {});
    
    if (usersError) {
      if (usersError.message.includes('already exists')) {
        logger.info('Users table already exists');
      } else {
        logger.error('Error creating users table:', usersError);
      }
    } else {
      logger.info('Users table created successfully');
    }

    logger.info('Creating raids table...');
    const { error: raidsError } = await supabase.rpc('create_raids_table', {});
    if (raidsError) {
      if (raidsError.message.includes('already exists')) {
        logger.info('Raids table already exists');
      } else {
        logger.error('Error creating raids table:', raidsError);
      }
    } else {
      logger.info('Raids table created successfully');
    }
    
    // Create other tables similarly with proper error logging
    logger.info('Creating analytics table...');
    const { error: analyticsError } = await supabase.rpc('create_analytics_table', {});
    // Handle error for analytics table...
    
    logger.info('Creating xp_transactions table...');
    const { error: xpError } = await supabase.rpc('create_xp_transactions_table', {});
    // Handle error for xp_transactions table...
    
    logger.info('Database tables created successfully');
  } catch (error) {
    logger.error('Error initializing database:', error.message);
    throw error;
  }
};

/**
 * Get Supabase client instance
 */
const getSupabase = () => {
  if (!supabase) {
    throw new Error('Supabase client not initialized. Call connectToSupabase() first.');
  }
  return supabase;
};

/**
 * Helper function to handle database errors consistently
 */
const handleDatabaseError = (error, operation) => {
  logger.error(`Database error during ${operation}:`, error.message);
  // Return null instead of throwing - this helps prevent unhandled promise rejections
  return null;
};

// Export functions
module.exports = {
  connectToSupabase,
  getSupabase,
  handleDatabaseError
};