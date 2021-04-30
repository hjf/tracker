const winston = require('winston')
const { v4: uuidv4 } = require('uuid')

const uuid = winston.format((info) => {
  return { ...info, uuid: uuidv4() }
})()

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.json(), winston.format.timestamp(), uuid),
  defaultMeta: { service: 'user-service', uuid: uuidv4 },
  transports: [
    new winston.transports.Console({ level: 'debug', timestamp: true })
    //
    // - Write all logs with level `error` and below to `error.log`
    // - Write all logs with level `info` and below to `combined.log`
    //
    // new winston.transports.File({ filename: 'error.log', level: 'error' }),
    // new winston.transports.File({ filename: 'combined.log' }),
  ]
})

module.exports = logger
