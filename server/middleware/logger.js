/**
 * Winston Logger
 * Provides structured logging with separate transports for console and file.
 * @module middleware/logger
 */

"use strict";

const { createLogger, format, transports } = require("winston");
const path = require("path");

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, stack }) => {
      return stack
        ? `[${timestamp}] ${level.toUpperCase()}: ${message}\n${stack}`
        : `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple()),
    }),
    new transports.File({
      filename: path.join(__dirname, "../logs/error.log"),
      level: "error",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
    new transports.File({
      filename: path.join(__dirname, "../logs/combined.log"),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
