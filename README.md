# Telegram Raid Bot on Sui Blockchain

A Telegram bot that facilitates Twitter raid campaigns with Sui blockchain rewards. Users can participate in Twitter engagement raids and earn XP points that can be converted to crypto tokens on the Sui blockchain.

## Features

- **Twitter Account Integration**: Connect your Twitter account securely through OAuth
- **Sui Wallet Integration**: Link existing wallets or generate new ones directly through the bot
- **XP System**: Earn experience points for Twitter engagements (likes, retweets, comments, bookmarks)
- **Reward Distribution**: Automatically distribute Sui tokens as rewards based on participation
- **Leaderboards**: Track top contributors through global and campaign-specific leaderboards
- **Raid Management**: Admins can create, configure, and monitor Twitter raid campaigns
- **Anti-Fraud Measures**: Verification systems to ensure genuine engagement
- **Multiple Reward Models**: Support for both pay-per-raid and threshold-based campaign rewards

## Prerequisites

- Node.js 16 or higher
- Telegram Bot Token from BotFather
- Twitter Developer API credentials
- Sui Wallet with funds for rewards
- Supabase account for database
  
## Configuration
  
Copy `.env.example` to `.env` in the project root and fill in your credentials:
  
```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
  
# Supabase
SUPABASE_URL=https://your-supabase-url
SUPABASE_KEY=your_supabase_anon_or_service_role_key
  
# Sui Blockchain
SUI_RPC_URL=https://fullnode.devnet.sui.io:443
SUI_WALLET_PRIVATE_KEY=your_sui_wallet_private_key
  
# Twitter OAuth2
TWITTER_API_KEY=your_twitter_api_key         # also called Client ID
TWITTER_API_SECRET=your_twitter_api_secret   # also called Client Secret
# For local development, set callback to localhost:
TWITTER_CALLBACK_URL=http://localhost:3000/api/twitter/callback
# For production:
# TWITTER_CALLBACK_URL=https://yourdomain.com/api/twitter/callback
  
# Optional environment settings
LOG_LEVEL=debug
PORT=3000
NODE_ENV=development
```
  
Be sure to whitelist the above `TWITTER_CALLBACK_URL` in your Twitter Developer App settings under "Callback URLs".

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/telegram-raid-bot.git
   cd telegram-raid-bot

   Made with love by: Canned Oxygen
   ```bash
   npm install
   ```

## Deployment to Heroku (True Production Hosting)

Follow these steps to deploy the bot as a web service on Heroku using webhooks:

1. Install the Heroku CLI and log in:
   ```bash
   heroku login
   ```
2. Create a new Heroku app (replace `<app-name>`):
   ```bash
   heroku create <app-name>
   ```
3. Provision any resources if needed (e.g., PostgreSQL, if not using Supabase).
4. Set your production configuration variables on Heroku:
   ```bash
   heroku config:set \
     TELEGRAM_BOT_TOKEN=<your_bot_token> \
     SUPABASE_URL=<your_supabase_url> \
     SUPABASE_KEY=<your_supabase_key> \
     SUI_RPC_URL=<your_sui_rpc_url> \
     SUI_WALLET_PRIVATE_KEY=<your_sui_wallet_private_key> \
     TWITTER_API_KEY=<your_twitter_client_id> \
     TWITTER_API_SECRET=<your_twitter_client_secret> \
     TWITTER_CALLBACK_URL=https://<app-name>.herokuapp.com/twitter/callback \
     NODE_ENV=production
   ```
5. Push your code to Heroku and scale the web dyno:
   ```bash
   git push heroku main
   heroku ps:scale web=1
   ```
6. In your Twitter Developer Portal, whitelist the callback URL:
   ```txt
   https://<app-name>.herokuapp.com/twitter/callback
   ```
7. Verify that your bot is running:
   ```bash
   heroku logs --tail
   ```

Once deployed, the bot will automatically set its webhook (to `${WEBHOOK_URL}/bot${TELEGRAM_BOT_TOKEN}`) and handle Twitter OAuth2 callbacks at `${TWITTER_CALLBACK_URL}`.