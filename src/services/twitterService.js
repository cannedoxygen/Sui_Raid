/**
 * Twitter Service
 * Handles Twitter API integration and OAuth flow
 */

const { TwitterApi } = require('twitter-api-v2');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../../config/config');
const { getSupabase } = require('./supabaseService');
const { linkTwitterAccount } = require('./userService');

// Store OAuth states temporarily (should move to database in production)
const oauthStates = {};

/**
 * Initialize Twitter client with app credentials
 * @returns {TwitterApi} Twitter API client
 */
const getTwitterClient = () => {
  try {
    // Ensure OAuth2 client credentials are configured
    const { apiKey, apiSecret } = config.twitter;
    if (!apiKey || !apiSecret) {
      throw new Error('Twitter OAuth2 client credentials not configured');
    }
    // Initialize client for OAuth2 PKCE flow
    return new TwitterApi({
      clientId: apiKey,
      clientSecret: apiSecret
    });
  } catch (error) {
    logger.error('Error initializing Twitter client:', error.message);
    throw new Error('Failed to initialize Twitter client');
  }
};

/**
 * Generate Twitter authentication URL
 * @param {number} telegramId - User's Telegram ID
 * @returns {string} OAuth URL for user to visit
 */
const generateTwitterAuthUrl = async (telegramId) => {
  try {
    const client = getTwitterClient();
    
    // Generate a state value to prevent CSRF attacks
    const state = crypto.randomBytes(20).toString('hex');
    
    // Store state with user's Telegram ID
    oauthStates[state] = {
      telegramId,
      timestamp: Date.now()
    };
    
    // Generate auth link with PKCE and CSRF protection using configured callback URL
    const authClient = client.generateOAuth2AuthLink(
      config.twitter.callbackUrl,
      {
        scope: [
          'tweet.read',
          'users.read',
          'like.read',
          'like.write',
          'follows.read',
          'follows.write',
          'offline.access'
        ],
        state
      }
    );
    
    // Store codeVerifier for PKCE along with state to validate on callback
    oauthStates[state].codeVerifier = authClient.codeVerifier;
    
    // Clean up old states (older than 1 hour)
    const now = Date.now();
    Object.keys(oauthStates).forEach(key => {
      if (now - oauthStates[key].timestamp > 3600000) {
        delete oauthStates[key];
      }
    });
    
    return authClient.url;
  } catch (error) {
    logger.error(`Error generating Twitter auth URL: ${error.message}`);
    throw new Error('Failed to generate Twitter authentication link');
  }
};

/**
 * Handle Twitter OAuth callback
 * @param {string} code - OAuth code from callback
 * @param {string} state - State parameter
 * @returns {Object} User and token info
 */
const handleTwitterCallback = async (code, state) => {
  try {
    // Verify state to prevent CSRF
    if (!oauthStates[state]) {
      throw new Error('Invalid or expired authentication state');
    }
    
    // Retrieve Telegram ID and PKCE codeVerifier from stored state
    const { telegramId, codeVerifier } = oauthStates[state];
    delete oauthStates[state]; // Clean up used state
    
    const client = getTwitterClient();
    
    // Get access token using PKCE codeVerifier
    const { client: userClient, accessToken, refreshToken, expiresIn } = await client.loginWithOAuth2({
      code,
      // Use configured callback URL for OAuth2
      redirectUri: config.twitter.callbackUrl,
      codeVerifier // Use stored PKCE codeVerifier
    });
    
    // Get user info
    const { data: twitterUser } = await userClient.v2.me({
      'user.fields': ['id', 'name', 'username', 'created_at', 'public_metrics']
    });
    
    // Link Twitter account to user
    await linkTwitterAccount(telegramId, {
      twitterId: twitterUser.id,
      username: twitterUser.username,
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000
    });
    
    // Store additional Twitter user info
    const supabase = getSupabase();
    await supabase
      .from('twitter_accounts')
      .upsert({
        twitter_id: twitterUser.id,
        username: twitterUser.username,
        name: twitterUser.name,
        created_at: twitterUser.created_at,
        followers_count: twitterUser.public_metrics?.followers_count || 0,
        following_count: twitterUser.public_metrics?.following_count || 0,
        tweet_count: twitterUser.public_metrics?.tweet_count || 0,
        verified: false, // Twitter API v2 has changed verification handling
        telegram_id: telegramId,
        last_updated: new Date().toISOString()
      });
    
    return {
      twitterUser,
      telegramId
    };
  } catch (error) {
    logger.error(`Error handling Twitter callback: ${error.message}`);
    throw new Error('Failed to complete Twitter authentication');
  }
};

/**
 * Get a user-authenticated Twitter client
 * @param {number} telegramId - User's Telegram ID
 * @returns {TwitterApi|null} Authenticated Twitter client or null if not authenticated
 */
const getUserTwitterClient = async (telegramId) => {
  try {
    // Get user's Twitter tokens
    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('users')
      .select('twitter_id, twitter_token, twitter_token_secret, twitter_refresh_token, twitter_token_expires_at')
      .eq('telegram_id', telegramId)
      .single();
    
    if (error || !user.twitter_token) {
      return null;
    }
    
    // Check if token is expired and refresh if needed
    if (user.twitter_token_expires_at && new Date(user.twitter_token_expires_at) < new Date()) {
      if (!user.twitter_refresh_token) {
        return null; // Cannot refresh without refresh token
      }
      
      // Refresh token
      const client = getTwitterClient();
      const { client: refreshedClient, accessToken, refreshToken, expiresIn } = 
        await client.refreshOAuth2Token(user.twitter_refresh_token);
      
      // Update tokens in database
      await supabase
        .from('users')
        .update({
          twitter_token: accessToken,
          twitter_refresh_token: refreshToken,
          twitter_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString()
        })
        .eq('telegram_id', telegramId);
      
      return refreshedClient;
    }
    
    // Create client with existing token
    return new TwitterApi(user.twitter_token);
  } catch (error) {
    logger.error('Error getting user Twitter client:', error.message);
    return null;
  }
};

/**
 * Get tweet information
 * @param {string} tweetUrl - URL of the tweet
 * @returns {Object} Tweet data
 */
const getTweetInfo = async (tweetUrl) => {
  try {
    // Extract tweet ID from URL
    const tweetId = extractTweetId(tweetUrl);
    if (!tweetId) {
      throw new Error('Invalid tweet URL');
    }
    
    const client = getTwitterClient();
    const { data: tweet } = await client.v2.singleTweet(tweetId, {
      'tweet.fields': [
        'created_at',
        'author_id',
        'public_metrics',
        'entities',
        'attachments'
      ],
      'user.fields': ['username', 'name', 'profile_image_url'],
      'expansions': ['author_id', 'attachments.media_keys'],
      'media.fields': ['type', 'url', 'preview_image_url']
    });
    
    return tweet;
  } catch (error) {
    logger.error('Error getting tweet info:', error.message);
    throw new Error('Failed to fetch tweet information');
  }
};

/**
 * Extract tweet ID from a Twitter URL
 * @param {string} url - Twitter URL
 * @returns {string|null} Tweet ID or null if invalid
 */
const extractTweetId = (url) => {
  try {
    // Handle both twitter.com and x.com URLs
    const twitterRegex = /(?:twitter|x)\.com\/\w+\/status\/(\d+)/;
    const match = url.match(twitterRegex);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
};

/**
 * Like a tweet
 * @param {number} telegramId - User's Telegram ID
 * @param {string} tweetId - Tweet ID to like
 * @returns {boolean} Success status
 */
const likeTweet = async (telegramId, tweetId) => {
  try {
    const userClient = await getUserTwitterClient(telegramId);
    if (!userClient) {
      return false;
    }
    
    await userClient.v2.like(userClient.currentUser.id, tweetId);
    return true;
  } catch (error) {
    logger.error('Error liking tweet:', error.message);
    return false;
  }
};

/**
 * Retweet a tweet
 * @param {number} telegramId - User's Telegram ID
 * @param {string} tweetId - Tweet ID to retweet
 * @returns {boolean} Success status
 */
const retweetTweet = async (telegramId, tweetId) => {
  try {
    const userClient = await getUserTwitterClient(telegramId);
    if (!userClient) {
      return false;
    }
    
    await userClient.v2.retweet(userClient.currentUser.id, tweetId);
    return true;
  } catch (error) {
    logger.error('Error retweeting tweet:', error.message);
    return false;
  }
};

/**
 * Reply to a tweet
 * @param {number} telegramId - User's Telegram ID
 * @param {string} tweetId - Tweet ID to reply to
 * @param {string} text - Reply text
 * @param {Object} mediaIds - Optional media IDs to attach
 * @returns {Object|null} Created tweet or null on failure
 */
const replyToTweet = async (telegramId, tweetId, text, mediaIds = []) => {
  try {
    const userClient = await getUserTwitterClient(telegramId);
    if (!userClient) {
      return null;
    }
    
    const { data } = await userClient.v2.reply(
      text,
      tweetId,
      {
        media: { media_ids: mediaIds }
      }
    );
    
    return data;
  } catch (error) {
    logger.error('Error replying to tweet:', error.message);
    return null;
  }
};

/**
 * Check if a user has liked a tweet
 * @param {number} telegramId - User's Telegram ID
 * @param {string} tweetId - Tweet ID to check
 * @returns {boolean} True if liked, false otherwise
 */
const hasUserLikedTweet = async (telegramId, tweetId) => {
  try {
    const userClient = await getUserTwitterClient(telegramId);
    if (!userClient) {
      return false;
    }
    
    const { data } = await userClient.v2.userLikedTweets(userClient.currentUser.id, {
      max_results: 100
    });
    
    return data.some(tweet => tweet.id === tweetId);
  } catch (error) {
    logger.error('Error checking if user liked tweet:', error.message);
    return false;
  }
};

/**
 * Check if a user has retweeted a tweet
 * @param {number} telegramId - User's Telegram ID
 * @param {string} tweetId - Tweet ID to check
 * @returns {boolean} True if retweeted, false otherwise
 */
const hasUserRetweetedTweet = async (telegramId, tweetId) => {
  try {
    const userClient = await getUserTwitterClient(telegramId);
    if (!userClient) {
      return false;
    }
    
    // There's no direct API for checking retweets, so we get user's recent tweets
    // and check if any are retweets of the target tweet
    const { data: tweets } = await userClient.v2.userTimeline(userClient.currentUser.id, {
      max_results: 100,
      'tweet.fields': ['referenced_tweets']
    });
    
    return tweets.some(tweet => 
      tweet.referenced_tweets && 
      tweet.referenced_tweets.some(ref => 
        ref.type === 'retweeted' && ref.id === tweetId
      )
    );
  } catch (error) {
    logger.error('Error checking if user retweeted tweet:', error.message);
    return false;
  }
};

/**
 * Get replies to a tweet from a specific user
 * @param {number} telegramId - User's Telegram ID
 * @param {string} tweetId - Tweet ID to check replies for
 * @returns {Array} Array of reply tweets or empty array
 */
const getUserRepliesToTweet = async (telegramId, tweetId) => {
  try {
    const userClient = await getUserTwitterClient(telegramId);
    if (!userClient) {
      return [];
    }
    
    // Get user's recent tweets
    const { data: tweets } = await userClient.v2.userTimeline(userClient.currentUser.id, {
      max_results: 100,
      'tweet.fields': ['referenced_tweets'],
      expansions: ['attachments.media_keys'],
      'media.fields': ['type', 'url']
    });
    
    // Filter for replies to the specific tweet
    return tweets.filter(tweet => 
      tweet.referenced_tweets && 
      tweet.referenced_tweets.some(ref => 
        ref.type === 'replied_to' && ref.id === tweetId
      )
    );
  } catch (error) {
    logger.error('Error getting user replies to tweet:', error.message);
    return [];
  }
};

module.exports = {
  generateTwitterAuthUrl,
  handleTwitterCallback,
  getTweetInfo,
  likeTweet,
  retweetTweet,
  replyToTweet,
  hasUserLikedTweet,
  hasUserRetweetedTweet,
  getUserRepliesToTweet,
  extractTweetId
};