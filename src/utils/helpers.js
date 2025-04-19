/**
 * Helper Utilities
 * Common utility functions used throughout the application
 */

const crypto = require('crypto');

/**
 * Generate a random string of specified length
 * @param {number} length - Length of the string to generate
 * @returns {string} Random string
 */
const generateRandomString = (length = 20) => {
  return crypto.randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
};

/**
 * Format date to a readable string
 * @param {Date|string|number} date - Date to format
 * @param {Object} options - Format options
 * @returns {string} Formatted date string
 */
const formatDate = (date, options = {}) => {
  const dateObj = date instanceof Date ? date : new Date(date);
  
  const defaults = {
    includeTime: true,
    shortFormat: false
  };
  
  const config = { ...defaults, ...options };
  
  if (config.shortFormat) {
    return dateObj.toLocaleDateString();
  }
  
  if (config.includeTime) {
    return dateObj.toLocaleString();
  }
  
  return dateObj.toLocaleDateString();
};

/**
 * Calculate time until a future date
 * @param {Date|string|number} futureDate - Future date
 * @returns {string} Human-readable time remaining
 */
const timeUntil = (futureDate) => {
  const future = new Date(futureDate).getTime();
  const now = Date.now();
  
  if (future <= now) {
    return 'already passed';
  }
  
  const diff = future - now;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days} day${days !== 1 ? 's' : ''}`;
  }
  
  if (hours > 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  
  if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
};

/**
 * Safely access nested object properties
 * @param {Object} obj - The object to access
 * @param {string} path - The path to the property (dot notation)
 * @param {any} defaultValue - Default value if property doesn't exist
 * @returns {any} Property value or default
 */
const getNestedValue = (obj, path, defaultValue = undefined) => {
  if (!obj || !path) return defaultValue;
  
  const keys = path.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(current, key)) {
      return defaultValue;
    }
    current = current[key];
  }
  
  return current === undefined ? defaultValue : current;
};

/**
 * Truncate text to a specified length with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
const truncateText = (text, maxLength = 100) => {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
};

/**
 * Split array into chunks of specified size
 * @param {Array} array - Array to split
 * @param {number} chunkSize - Size of each chunk
 * @returns {Array} Array of chunks
 */
const chunkArray = (array, chunkSize = 10) => {
  if (!Array.isArray(array)) return [];
  
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  
  return chunks;
};

/**
 * Delay execution for specified milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} Promise that resolves after delay
 */
const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Validate if a string is a valid URL
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Format number with commas as thousands separators
 * @param {number} number - Number to format
 * @returns {string} Formatted number
 */
const formatNumber = (number) => {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

/**
 * Check if a string is a valid Sui address
 * @param {string} address - Address to check
 * @returns {boolean} True if valid Sui address
 */
const isValidSuiAddress = (address) => {
  // Sui addresses start with 0x and are 42 characters long (including 0x)
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

/**
 * Check if a string contains HTML
 * @param {string} text - Text to check
 * @returns {boolean} True if contains HTML
 */
const containsHtml = (text) => {
  return /<[a-z][\s\S]*>/i.test(text);
};

/**
 * Generate a progress bar string
 * @param {number} current - Current value
 * @param {number} total - Total value
 * @param {number} length - Length of progress bar
 * @returns {string} Progress bar string
 */
const progressBar = (current, total, length = 20) => {
  const percentage = Math.min(100, Math.round((current / total) * 100));
  const filledLength = Math.round((length * current) / total);
  const filled = '█'.repeat(filledLength);
  const empty = '░'.repeat(length - filledLength);
  
  return `[${filled}${empty}] ${percentage}%`;
};

/**
 * Convert string to title case
 * @param {string} str - String to convert
 * @returns {string} Title cased string
 */
const toTitleCase = (str) => {
  if (!str) return '';
  
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * Generate a secure hash of a string
 * @param {string} text - Text to hash
 * @returns {string} Hashed string
 */
const hashString = (text) => {
  return crypto
    .createHash('sha256')
    .update(text)
    .digest('hex');
};

/**
 * Mask a sensitive string (like private key)
 * @param {string} text - Text to mask
 * @param {number} visibleChars - Number of visible characters at start/end
 * @returns {string} Masked string
 */
const maskSensitiveString = (text, visibleChars = 4) => {
  if (!text) return '';
  
  const length = text.length;
  if (length <= visibleChars * 2) {
    return '*'.repeat(length);
  }
  
  const start = text.substring(0, visibleChars);
  const end = text.substring(length - visibleChars);
  const mask = '*'.repeat(length - (visibleChars * 2));
  
  return start + mask + end;
};

module.exports = {
  generateRandomString,
  formatDate,
  timeUntil,
  getNestedValue,
  truncateText,
  chunkArray,
  sleep,
  isValidUrl,
  formatNumber,
  isValidSuiAddress,
  containsHtml,
  progressBar,
  toTitleCase,
  hashString,
  maskSensitiveString
};