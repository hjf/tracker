const jspredict = require('jspredict')
const logger = require('../logger')
const db = require('../db.js')
const dayjs = require('dayjs')

async function generateSchedule(force) {
  try {
    logger.info("Generating predictions")
    const location = db.getSetting('ground_station_location');
    const min_elevation = db.getSetting('satellite_min_elevation') || 10;

    let passes = await db.getScheduledEvents('satellite_pass')
    if (passes.length > 0) {
      if (force) {
        let deleted = await db.deleteScheduledEvents('satellite_pass')
        console.log(deleted)
        logger.info(`Passes for today already but 'force' was specified, deleting ${deleted} scheduled passes first`)

      } else {
        logger.info("Passes for today already predicted.")
        return false
      }
    }

    logger.debug(`Ground station at ${location.lat}, ${location.lon}, ${location.alt} meters.`)
    logger.debug(`Minimum elevation for predictions: ${min_elevation} degrees`)

    const sats = await db.getSatellites();

    for (let sat of sats) {

      logger.debug(`Predicting for satellite ${sat.name} (${sat.catalog_number})`)

      const predictions = getPredictions(
        sat.tle,
        location.lat, location.lon, location.alt,
        Date.now(),
        dayjs().add('1', 'days').valueOf(),
        min_elevation,
        5
      )
      logger.debug(`${predictions.length} passes found.`)

      for (let prediction of predictions) {
        let action = {
          satellite: sat,
          prediction: prediction
        }

        await db.addScheduledEvent("satellite_pass", prediction.start, action)
      }

    }
    return true
  } catch (err) {
    logger.error(err.message)
    return false
  }
}

function getPredictions(tle, lat, lon, alt, start, end, min_elevation, max_predictions) {
  return jspredict.transits(
    tle,
    [lat, lon, alt / 1000],
    start,
    end,
    min_elevation,
    max_predictions
  )
}

module.exports = { generateSchedule }