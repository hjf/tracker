const Transport = require('winston-transport')
const winston = require('winston')

//
// Inherit from `winston-transport` so you can take advantage
// of the base functionality and `.exceptions.handle()`.
//
module.exports = class SocketIoTransport extends Transport {
  constructor (opts) {
    opts.format = winston.format.json()
    super(opts)
    this.io = opts.io
  }

  log (info, callback) {
    setImmediate(() => {
      this.emit('logged', info)
    })

    let msg = info
    if (info instanceof Error) {
      msg = Error.message
    }

    if (this.io) {
      this.io.emit('log', msg)
    }

    callback()
  }
}
