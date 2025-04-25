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
    const clientId = process.env.TWITTER_CLIENT_ID || process.env.TWITTER_API_KEY;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET || process.env.TWITTER_API_SECRET;
    
    if (!clientId || !clientSecret) {
      throw new Error('Twitter OAuth2 client credentials not configured');
    }
    
    // Initialize client for OAuth2 PKCE flow
    logger.debug('Creating Twitter API client with configured credentials');
    return new TwitterApi({
      clientId: clientId,
      clientSecret: clientSecret
    });
  } catch (error) {
    logger.error(`Error initializing Twitter client: ${error.message}`);
    throw new Error(`Failed to initialize Twitter client: ${error.message}`);
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
    
    // Build callback URL based on environment
    let callbackUrl;
    if (process.env.NODE_ENV === 'production') {
      callbackUrl = process.env.TWITTER_CALLBACK_URL || `${process.env.WEBHOOK_URL}/twitter/callback`;
    } else {
      const port = process.env.PORT || 3000;
      callbackUrl = process.env.TWITTER_CALLBACK_URL || `http://localhost:${port}/twitter/callback`;
    }
    
    logger.info(`Using Twitter callback URL: ${callbackUrl}`);
    
    // Generate auth link with PKCE and CSRF protection
    const authClient = client.generateOAuth2AuthLink(
      callbackUrl,
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
    
    logger.debug(`Generated Twitter auth URL for user ${telegramId}, state: ${state.substring(0, 6)}...`);
    return authClient.url;
  } catch (error) {
    logger.error(`Error generating Twitter auth URL: ${error.message}`);
    throw new Error(`Failed to generate Twitter authentication link: ${error.message}`);
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
      logger.warn(`Invalid or expired OAuth state: ${state.substring(0, 6)}...`);
      throw new Error('Invalid or expired authentication state');
    }
    
    // Retrieve Telegram ID and PKCE codeVerifier from stored state
    const { telegramId, codeVerifier } = oauthStates[state];
    logger.info(`Processing Twitter callback for user ${telegramId}, state: ${state.substring(0, 6)}...`);
    
    delete oauthStates[state]; // Clean up used state
    
    const client = getTwitterClient();
    
    // Build callback URL based on environment (must match the one used to generate auth URL)
    let callbackUrl;
    if (process.env.NODE_ENV === 'production') {
      callbackUrl = process.env.TWITTER_CALLBACK_URL || `${process.env.WEBHOOK_URL}/twitter/callback`;
    } else {
      const port = process.env.PORT || 3000;
      callbackUrl = process.env.TWITTER_CALLBACK_URL || `http://localhost:${port}/twitter/callback`;
    }
    
    // Get access token using PKCE codeVerifier
    const { client: userClient, accessToken, refreshToken, expiresIn } = await client.loginWithOAuth2({
      code,
      redirectUri: callbackUrl,
      codeVerifier // Use stored PKCE codeVerifier
    });
    
    // Get user info
    const { data: twitterUser } = await userClient.v2.me({
      'user.fields': ['id', 'name', 'username', 'created_at', 'public_metrics']
    });
    
    logger.info(`Twitter user authenticated: @${twitterUser.username} (ID: ${twitterUser.id})`);
    
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
    if (supabase) {
      try {
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
        logger.debug(`Twitter account details stored for @${twitterUser.username}`);
      } catch (error) {
        logger.warn(`Failed to store Twitter account details: ${error.message}`);
        // Continue anyway - this is not critical
      }
    }
    
    return {
      twitterUser,
      telegramId
    };
  } catch (error) {
    logger.error(`Error handling Twitter callback: ${error.message}`);
    throw new Error(`Failed to complete Twitter authentication: ${error.message}`);
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
    
    // Handle cases where Supabase isn't connected
    if (!supabase) {
      logger.error('Cannot get Twitter client: Supabase is not connected');
      return null;
    }
    
    const { data: user, error } = await supabase
      .from('users')
      .select('twitter_id, twitter_token, twitter_token_secret, twitter_refresh_token, twitter_token_expires_at')
      .eq('telegram_id', telegramId)
      .single();
    
    if (error) {
      logger.error(`Error fetching user Twitter credentials: ${error.message}`);
      return null;
    }
    
    if (!user || !user.twitter_token) {
      logger.debug(`User ${telegramId} has no Twitter token`);
      return null;
    }
    
    // Check if token is expired and refresh if needed
    if (user.twitter_token_expires_at && new Date(user.twitter_token_expires_at) < new Date()) {
      if (!user.twitter_refresh_token) {
        logger.warn(`User ${telegramId} has expired token but no refresh token`);
        return null; // Cannot refresh without refresh token
      }
      
      // Refresh token
      logger.debug(`Refreshing Twitter token for user ${telegramId}`);
      const client = getTwitterClient();
      try {
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
        
        logger.info(`Twitter token refreshed for user ${telegramId}`);
        return refreshedClient;
      } catch (refreshError) {
        logger.error(`Error refreshing Twitter token: ${refreshError.message}`);
        return null;
      }
    }
    
    // Create client with existing token
    logger.debug(`Creating Twitter client for user ${telegramId} with existing token`);
    return new TwitterApi(user.twitter_token);
  } catch (error) {
    logger.error(`Error getting user Twitter client: ${error.message}`);
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
      logger.error(`Invalid tweet URL: ${tweetUrl}`);
      throw new Error('Invalid tweet URL');
    }
    
    logger.info(`Fetching info for tweet ID: ${tweetId}`);
    const client = getTwitterClient();
    
    try {
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
      
      logger.debug(`Tweet info fetched successfully for ID: ${tweetId}`);
      return tweet;
    } catch (tweetError) {
      // Handle Twitter API errors more specifically
      if (tweetError.code === 429) {
        logger.error('Twitter rate limit exceeded, please try again later');
        throw new Error('Twitter rate limit exceeded, please try again later');
      } else if (tweetError.code === 401) {
        logger.error('Twitter authentication error, token may be invalid');
        throw new Error('Twitter authentication error, please reconnect your account');
      } else {
        logger.error(`Twitter API error: ${tweetError.message}`);
        throw new Error(`Twitter API error: ${tweetError.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error getting tweet info: ${error.message}`);
    throw new Error(`Failed to fetch tweet information: ${error.message}`);
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
    if (match) {
      return match[1];
    }
    
    // Handle t.co shortened URLs
    const shortUrlRegex = /t\.co\/([a-zA-Z0-9]+)/;
    const shortMatch = url.match(shortUrlRegex);
    if (shortMatch) {
      logger.warn('Shortened URL detected, may need to expand URL first');
    }
    
    return null;
  } catch (error) {
    logger.error(`Error extracting tweet ID: ${error.message}`);
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
      logger.warn(`Cannot like tweet: No Twitter client for user ${telegramId}`);
      return false;
    }
    
    logger.info(`User ${telegramId} liking tweet ${tweetId}`);
    await userClient.v2.like(userClient.currentUser.id, tweetId);
    return true;
  } catch (error) {
    logger.error(`Error liking tweet: ${error.message}`);
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
      logger.warn(`Cannot retweet: No Twitter client for user ${telegramId}`);
      return false;
    }
    
    logger.info(`User ${telegramId} retweeting tweet ${tweetId}`);
    await userClient.v2.retweet(userClient.currentUser.id, tweetId);
    return true;
  } catch (error) {
    logger.error(`Error retweeting tweet: ${error.message}`);
    return false;
  }
};

/**
 * Reply to a tweet
 * @param {number} telegramId - User's Telegram ID
 * @param {string} tweetId - Tweet ID to reply to
 * @param {string} text - Reply text
 * @param {Array} mediaIds - Optional media IDs to attach
 * @returns {Object|null} Created tweet or null on failure
 */
const replyToTweet = async (telegramId, tweetId, text, mediaIds = []) => {
  try {
    const userClient = await getUserTwitterClient(telegramId);
    if (!userClient) {
      logger.warn(`Cannot reply to tweet: No Twitter client for user ${telegramId}`);
      return null;
    }
    
    logger.info(`User ${telegramId} replying to tweet ${tweetId}`);
    const { data } = await userClient.v2.reply(
      text,
      tweetId,
      {
        media: { media_ids: mediaIds.length > 0 ? mediaIds : undefined }
      }
    );
    
    return data;
  } catch (error) {
    logger.error(`Error replying to tweet: ${error.message}`);
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
      logger.warn(`Cannot check likes: No Twitter client for user ${telegramId}`);
      return false;
    }
    
    // Get user's liked tweets
    logger.debug(`Checking if user ${telegramId} liked tweet ${tweetId}`);
    const { data } = await userClient.v2.userLikedTweets(userClient.currentUser.id, {
      max_results: 100
    });
    
    return data.some(tweet => tweet.id === tweetId);
  } catch (error) {
    logger.error(`Error checking if user liked tweet: ${error.message}`);
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
      logger.warn(`Cannot check retweets: No Twitter client for user ${telegramId}`);
      return false;
    }
    
    // There's no direct API for checking retweets, so we get user's recent tweets
    // and check if any are retweets of the target tweet
    logger.debug(`Checking if user ${telegramId} retweeted tweet ${tweetId}`);
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
    logger.error(`Error checking if user retweeted tweet: ${error.message}`);
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
      logger.warn(`Cannot check replies: No Twitter client for user ${telegramId}`);
      return [];
    }
    
    // Get user's recent tweets
    logger.debug(`Checking if user ${telegramId} replied to tweet ${tweetId}`);
    const { data: tweets } = await userClient.v2.userTimeline(userClient.currentUser.id, {
      max_results: 100,
      'tweet.fields': ['referenced_tweets', 'text', 'attachments'],
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
    logger.error(`Error getting user replies to tweet: ${error.message}`);
    return [];
  }
};

/**
 * Express route handler for Twitter OAuth2 callback
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const expressCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    logger.info(`Twitter callback received with state: ${state?.substring(0, 6)}...`);
    
    if (!code || !state) {
      logger.error('Twitter callback missing code or state');
      return res.status(400).send('Missing required parameters');
    }
    
    const result = await handleTwitterCallback(code, state);
    if (!result) {
      logger.error('Twitter authentication failed, no result returned');
      return res.status(400).send('Authentication failed');
    }
    
    const { getUserById } = require('./userService');
    const user = await getUserById(result.telegramId);
    if (!user) {
      logger.error(`User ${result.telegramId} not found after Twitter authentication`);
      return res.status(404).send('User not found');
    }
    
    const botUsername = process.env.BOT_USERNAME || 'your_bot';
    logger.info(`Twitter auth successful for user ${result.telegramId}, redirecting to bot`);
    
    // Create success page with redirect back to bot
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Twitter Account Connected</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: Arial, sans-serif;
              text-align: center;
              margin: 0;
              padding: 20px;
              background-color: #f5f8fa;
              color: #14171a;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background-color: white;
              border-radius: 16px;
              padding: 30px;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            }
            h1 {
              color: #1d9bf0;
              margin-bottom: 20px;
            }
            p {
              margin-bottom: 30px;
              font-size: 16px;
              line-height: 1.5;
            }
            .button {
              display: inline-block;
              background-color: #1d9bf0;
              color: white;
              text-decoration: none;
              padding: 12px 24px;
              border-radius: 50px;
              font-weight: bold;
              transition: background-color 0.3s;
            }
            .button:hover {
              background-color: #1a8cd8;
            }
            .success-icon {
              font-size: 72px;
              margin-bottom: 20px;
              color: #4BB543;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✓</div>
            <h1>Twitter Account Connected!</h1>
            <p>
              Your Twitter account @${result.twitterUser.username} has been successfully connected to your Telegram account.
              You can now participate in Twitter raids and earn rewards!
            </p>
            <a href="https://t.me/${botUsername}" class="button">Return to Bot</a>
          </div>
        </body>
      </html>
    `;
    
    res.send(html);
  } catch (error) {
    logger.error(`Error in Twitter callback: ${error.message}`);
    res.status(500).send(`Authentication failed: ${error.message}`);
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
  extractTweetId,
  expressCallback
};