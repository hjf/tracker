const Transport = require('winston-transport');
const winston = require('winston');

const util = require('util');
const { showCompletionScript } = require('yargs');
//
// Inherit from `winston-transport` so you can take advantage
// of the base functionality and `.exceptions.handle()`.
//
module.exports = class SocketIoTransport extends Transport {
  io = null
  constructor(opts) {
    opts.format = winston.format.json()
    super(opts);
    this.io = opts.io
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    if (this.io) {
      this.io.emit('log', info)
    }

    callback();
  }

};