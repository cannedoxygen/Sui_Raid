const { Telegraf } = require('telegraf');
const commands = require('./commands');
const { setupMiddleware } = require('./src/bot/middleware');

function initBot() {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  // Global middleware
  bot.use(middleware.logger);

  // Commands
  commands.register(bot);

  bot.launch();
  console.log('🤖 Telegram Raid Bot is live!');
}

module.exports = { initBot };
