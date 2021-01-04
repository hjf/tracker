const logger = require('../logger')
const db = require('../db')
const imagemin = require("imagemin");
const imageminMozjpeg = require("imagemin-mozjpeg");
const pngToJpeg = require('png-to-jpeg');

const TelegramBot = require('node-telegram-bot-api');

const tconfig = db.getSetting('telegram');
const bot = new TelegramBot(tconfig.access_token, { polling: true });

async function postImage(filepath, caption) {
  let buf = await resizeImage(filepath)
  console.log(buf)
  let buf = buf[0].data
  return bot.sendPhoto(tconfig.chat_ids[0], buf, { caption: caption }, { filename: `${Date.now()}.jpg`, contentType: "image/jpeg" });
}

module.exports = {
  postImage: postImage
}

async function resizeImage(filepath, quality = 80) {
  let buf = await imagemin([filepath], { destination: '.', plugins: [pngToJpeg({ quality: 100 }), imageminMozjpeg({ quality: quality })] });
  return buf;
}