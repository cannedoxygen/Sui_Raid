// api/twitter/callback.js
const { expressCallback } = require('../../src/services/twitterService');

module.exports = async (req, res) => {
  try {
    await expressCallback(req, res);
  } catch (err) {
    console.error('Error in serverless Twitter callback:', err);
    res.status(500).send('Server Error');
  }
};