/**
 * Global Error Handler Middleware
 * Catches all errors thrown by route handlers and returns a consistent JSON error response.
 * @module middleware/errorHandler
 */

"use strict";

const logger = require("./logger");

/**
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  logger.error(`${req.method} ${req.originalUrl} → ${status}: ${message}`, err);

  res.status(status).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
}

module.exports = errorHandler;
