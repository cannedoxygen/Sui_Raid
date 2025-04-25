/**
 * Logger Utility
 * Provides consistent logging throughout the application
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log level based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  
  // Use specific LOG_LEVEL from env if available
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  
  // Otherwise use debug in development, info in production
  return isDevelopment ? 'debug' : 'info';
};

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf((info) => {
    // Add error stack trace if available
    const stack = info.stack ? `\n${info.stack}` : '';
    return `${info.timestamp} ${info.level.toUpperCase()}: ${info.message}${stack}`;
  })
);

// Define colored format for console
const coloredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf((info) => {
    // Add error stack trace if available
    const stack = info.stack ? `\n${info.stack}` : '';
    return `${info.timestamp} ${info.level}: ${info.message}${stack}`;
  })
);

// Define transports
const transports = [
  // Console transport (always enabled)
  new winston.transports.Console({
    format: coloredFormat
  }),
];

// Add file transports in production or when DEBUG_MODE is true
if (process.env.NODE_ENV === 'production' || process.env.DEBUG_MODE === 'true') {
  // Error log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: format,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
  
  // Combined log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: format,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
  exitOnError: false, // Don't exit on handled exceptions
});

// Ensure uncaught exceptions don't crash the app but are logged
logger.exceptions.handle(
  new winston.transports.File({ 
    filename: path.join(logsDir, 'exceptions.log'),
    format: format,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  })
);

// Override console methods with our logger in non-production environments
if (process.env.NODE_ENV !== 'production' && process.env.OVERRIDE_CONSOLE === 'true') {
  console.log = (...args) => logger.info(args.join(' '));
  console.info = (...args) => logger.info(args.join(' '));
  console.warn = (...args) => logger.warn(args.join(' '));
  console.error = (...args) => logger.error(args.join(' '));
  console.debug = (...args) => logger.debug(args.join(' '));
  
  logger.debug('Console methods overridden with logger');
}

// Log startup info
logger.info(`Logger initialized at level: ${level()}`);
logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

// Export logger
module.exports = logger;