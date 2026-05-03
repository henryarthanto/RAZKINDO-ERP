import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
  redact: ['req.headers.authorization', 'req.headers.cookie', 'password', 'token', 'secret'],
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  hooks: {
    logMethod(inputArgs, method, level) {
      return method.apply(this, inputArgs);
    },
  },
});

// Convenience methods
export const logError = (msg: string, err?: unknown, context?: Record<string, unknown>) => {
  logger.error({ err, ...context }, msg);
};

export const logWarn = (msg: string, context?: Record<string, unknown>) => {
  logger.warn(context, msg);
};

export const logInfo = (msg: string, context?: Record<string, unknown>) => {
  logger.info(context, msg);
};

export const logDebug = (msg: string, context?: Record<string, unknown>) => {
  logger.debug(context, msg);
};

export default logger;
