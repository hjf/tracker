const winston = require('winston')

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.json(), winston.format.timestamp()),
  defaultMeta: { service: 'user-service' },
  transports: [
    new winston.transports.Console({ level: 'debug' })
    //
    // - Write all logs with level `error` and below to `error.log`
    // - Write all logs with level `info` and below to `combined.log`
    //
    // new winston.transports.File({ filename: 'error.log', level: 'error' }),
    // new winston.transports.File({ filename: 'combined.log' }),
  ]
})

module.exports = logger
