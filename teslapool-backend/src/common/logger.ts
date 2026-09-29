import winston from 'winston';
import { config } from '../config/env';
import { requestContext } from './request-context';

/**
 * Structured JSON logs (pretty-printed only in local development). Every entry
 * automatically carries the current requestId/userId from AsyncLocalStorage.
 */
const withContext = winston.format((info) => {
  const ctx = requestContext.getStore();
  if (ctx) {
    info.requestId ??= ctx.requestId;
    if (ctx.userId) info.userId ??= ctx.userId;
  }
  return info;
});

const pretty = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} ${level} ${message}${rest}`;
});

export const logger = winston.createLogger({
  level: config.logLevel === 'silent' ? 'error' : config.logLevel,
  silent: config.logLevel === 'silent',
  defaultMeta: { service: 'teslapool-api' },
  format:
    config.env === 'development'
      ? winston.format.combine(withContext(), winston.format.timestamp({ format: 'HH:mm:ss.SSS' }), winston.format.colorize(), pretty)
      : winston.format.combine(withContext(), winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});
