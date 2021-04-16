const logger = require('../logger')
const db = require('../db')

const TelegramBot = require('node-telegram-bot-api')

const tconfig = db.getSetting('telegram')
const bot = new TelegramBot(tconfig.access_token, { polling: true })

async function postImage (filepath, caption) {
  logger.info(`Posting image ${filepath} to telegram chat id ${tconfig.chat_ids[0]}`)
  return bot.sendPhoto(tconfig.chat_ids[0], filepath, { caption: caption }, { filename: `${Date.now()}.jpg`, contentType: 'image/jpeg' })
}

module.exports = {
  postImage: postImage
}
