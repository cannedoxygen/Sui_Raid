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
    const { data, error } = await supabase.from('users').select('count').limit(1);
    
    if (error) {
      // If error is because table doesn't exist, initialize database
      if (error.code === '42P01') {  // PostgreSQL error code for undefined_table
        logger.info('Tables do not exist. Initializing database...');
        await initializeDatabase();
        logger.info('Database initialized successfully');
      } else {
        throw error;
      }
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
    // Create users table
    const { error: usersError } = await supabase.rpc('create_users_table', {});
    if (usersError && !usersError.message.includes('already exists')) {
      throw usersError;
    }
    
    // Create raids table
    const { error: raidsError } = await supabase.rpc('create_raids_table', {});
    if (raidsError && !raidsError.message.includes('already exists')) {
      throw raidsError;
    }
    
    // Create campaigns table
    const { error: campaignsError } = await supabase.rpc('create_campaigns_table', {});
    if (campaignsError && !campaignsError.message.includes('already exists')) {
      throw campaignsError;
    }
    
    // Create user_actions table
    const { error: userActionsError } = await supabase.rpc('create_user_actions_table', {});
    if (userActionsError && !userActionsError.message.includes('already exists')) {
      throw userActionsError;
    }
    
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
  throw new Error(`Database operation failed: ${operation}`);
};

// Export functions
module.exports = {
  connectToSupabase,
  getSupabase,
  handleDatabaseError
};