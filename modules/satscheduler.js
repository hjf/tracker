const jspredict = require('jspredict')
const logger = require('../logger')
const db = require('../db.js')
const dayjs = require('dayjs')
const _ = require('lodash')
const SunCalc = require('suncalc')

async function generateSchedule (force) {
  try {
    logger.info('Generating predictions')
    const location = db.getSetting('ground_station_location')
    const minElevation = db.getSetting('satellite_min_elevation') || 10

    const passes = await db.getScheduledEvents('satellite_pass')

    if (passes.length > 0) {
      if (force) {
        const deleted = await db.deleteScheduledEvents('satellite_pass')
        logger.info(`Passes for today already but 'force' was specified, deleting ${deleted} scheduled passes first`)
      }
    }

    let predictStart = 0
    if (passes.length > 0) { predictStart = _.maxBy(passes, 'schedule_time') + 300000 }// delay by 5 minutes to avoid duplicates because we mess with the original start time

    if (predictStart < Date.now()) { predictStart = Date.now() }

    logger.debug(`Ground station at ${location.lat}, ${location.lon}, ${location.alt} meters.`)
    logger.debug(`Minimum elevation for predictions: ${minElevation} degrees`)

    const sats = await db.getSatellites()

    for (const sat of sats) {
      if (!sat.enabled) {
        logger.debug(`Skipping disabled satellite ${sat.name} (${sat.catalog_number})`)
        continue
      }

      logger.debug(`Predicting for satellite ${sat.name} (${sat.catalog_number})`)

      const predictions = getPredictions(
        sat.tle,
        location.lat, location.lon, location.alt,
        new Date(predictStart),
        new Date(dayjs(predictStart).add('7', 'days').valueOf()),
        minElevation,
        50
      )

      const startEndElevation = db.getSetting('start_end_elevation') || 5

      // for each prediction, offset it until it's between start_end_elevation

      for (const prediction of predictions) {
        let startTime = prediction.start

        let minelev = 0
        do {
          startTime += 5000
          prediction.startPosition = jspredict.observe(sat.tle, [location.lat, location.lon, location.alt], startTime)
          minelev = prediction.startPosition.elevation
        } while (minelev < startEndElevation)
        prediction.start = startTime
      }

      for (const prediction of predictions) {
        const startTime = prediction.start
        let endTime = prediction.end

        let minelev = 0
        do {
          endTime -= 5000
          prediction.endPosition = jspredict.observe(sat.tle, [location.lat, location.lon, location.alt], endTime)
          minelev = prediction.endPosition.elevation
        } while (minelev < startEndElevation)
        prediction.end = endTime
        prediction.duration = endTime - startTime

        // I don't think this works if the sat crosses over the poles
        prediction.direction = prediction.startPosition.azimuth < prediction.endPosition.azimuth ? 'N' : 'S'
      }

      for (const prediction of predictions) {
        prediction.sun_position = SunCalc.getPosition(prediction.start, location.lat, location.lon)
        prediction.sun_position.azimuth = prediction.sun_position.azimuth * 180 / Math.PI
        prediction.sun_position.altitude = prediction.sun_position.altitude * 180 / Math.PI
      }

      logger.debug(`${predictions.length} passes found.`)

      for (const prediction of predictions) {
        const action = {
          satellite: sat,
          prediction: prediction
        }

        await db.addScheduledEvent('satellite_pass', prediction.start, action)
      }
    }
    return true
  } catch (err) {
    logger.error(err.message)
    return false
  }
}

function getPredictions (tle, lat, lon, alt, start, end, minElevation, maxPredictions) {
  return jspredict.transits(
    tle,
    [lat, lon, alt / 1000],
    start,
    end,
    minElevation,
    maxPredictions
  )
}

module.exports = { generateSchedule }
