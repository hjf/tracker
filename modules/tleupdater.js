const _ = require('lodash')
const CELESTRAK_BASE = 'https://www.celestrak.com/NORAD/elements/'
const axios = require('axios').default
const logger = require('../logger')
const db = require('../db.js')
require('core-js/features/string/replace-all')

async function updateTLEs (force, io) {
  logger.info('Checking if TLEs need updating')
  try {
    const tleMaxAgeDays = db.getSetting('tle_max_age_days') || 3
    logger.debug(`TLE max age is ${tleMaxAgeDays} days`)

    const maxage = new Date().getTime() / 1000 - tleMaxAgeDays * 86400
    const tlefiles = {}

    const sats = await db.getSatellites()
    logger.debug(`${sats.length} satellites in database`)

    if (force || _.some(sats, o => o.last_update === null || o.last_update < maxage)) {
      logger.debug('Some satellites need updating. Starting...')

      for (const sat of sats) {
        if (!tlefiles[sat.tle_file]) {
          logger.debug(`Downloading TLE file ${sat.tle_file}`)

          const url = `${CELESTRAK_BASE}${sat.tle_file}`
          const response = await axios.get(url, { timeout: 5000 })
          tlefiles[sat.tle_file] = response.data
        }

        const tledata = tlefiles[sat.tle_file]
        const re = new RegExp(`(.+\\n.+${sat.catalog_number}(?:U|C|S).+\\n.+\\n)`, 'gm')
        const reres = re.exec(tledata.replaceAll('\r\n', '\n'))
        const tle = reres[0]
        logger.debug(`TLE data: ${tle}`)

        if (!tle) { throw new Error(`TLE for ${sat.catalog_number} (${sat.name}) not found in ${sat.tle_file}`) }

        await db.updateTLE(sat.catalog_number, tle)
      }
      logger.info('All satelites updated.')
      if (io) io.emit('new_schedules', {})
    } else {
      logger.info('No updates required.')
    }
  } catch (err) {
    logger.error(err)
  }
}

module.exports = {
  updateTLEs: updateTLEs
}
