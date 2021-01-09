const Transport = require('winston-transport');
const winston = require('winston');
const db = require('../db')
//
// Inherit from `winston-transport` so you can take advantage
// of the base functionality and `.exceptions.handle()`.
//
module.exports = class SQLiteTransport extends Transport {
  constructor(opts) {
    opts.format = winston.format.json()
    super(opts);
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    try {
      db.log(info)
    } catch (err) {
      console.error(err)
    }

    callback();
  }

};