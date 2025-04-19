/**
 * Express Server
 * Handles HTTP routes including Twitter OAuth callbacks
 */

const express = require('express');
const bodyParser = require('body-parser');
const logger = require('./utils/logger');
const twitterService = require('./services/twitterService');
const userService = require('./services/userService');
const config = require('../config/config');

// Create Express app
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Basic route to check if server is running
app.get('/', (req, res) => {
  res.send('Telegram Raid Bot API is running!');
});

/**
 * Twitter OAuth callback route
 * Processes authentication callback from Twitter
 */
app.get('/twitter/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).send('Missing required parameters');
    }
    
    // Process Twitter callback
    const result = await twitterService.handleTwitterCallback(code, state);
    
    if (!result) {
      return res.status(400).send('Authentication failed');
    }
    
    // Get the user
    const user = await userService.getUserById(result.telegramId);
    
    if (!user) {
      return res.status(404).send('User not found');
    }
    
    // Create success message with bot's username
    const botUsername = process.env.BOT_USERNAME || 'your_bot';
    
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
    logger.error('Error handling Twitter callback:', error.message);
    res.status(500).send('Authentication failed: ' + error.message);
  }
});

/**
 * Start the Express server
 * @param {number} port - Port to listen on
 * @returns {Object} HTTP server instance
 */
const startServer = (port = config.server.port) => {
  return app.listen(port, () => {
    logger.info(`Express server listening on port ${port}`);
  });
};

module.exports = {
  app,
  startServer
};