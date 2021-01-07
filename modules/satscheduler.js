const jspredict = require('jspredict')
const logger = require('../logger')
const db = require('../db.js')
const dayjs = require('dayjs')
const _ = require('lodash')
const SunCalc = require('suncalc');

async function generateSchedule(force) {
  try {
    logger.info("Generating predictions")
    const location = db.getSetting('ground_station_location');
    const min_elevation = db.getSetting('satellite_min_elevation') || 10;

    let passes = await db.getScheduledEvents('satellite_pass')

    if (passes.length > 0) {
      if (force) {
        let deleted = await db.deleteScheduledEvents('satellite_pass')
        logger.info(`Passes for today already but 'force' was specified, deleting ${deleted} scheduled passes first`)

      }
    }
    predict_start = 0
    if (passes.length > 0)
      predict_start = _.maxBy(passes, schedule_time) + 600000//delay by 10 minutes to avoid duplicates because we mess with the original start time

    if (predict_start < Date.now())
      predict_start = Date.now()

    logger.debug(`Ground station at ${location.lat}, ${location.lon}, ${location.alt} meters.`)
    logger.debug(`Minimum elevation for predictions: ${min_elevation} degrees`)

    const sats = await db.getSatellites();

    for (let sat of sats) {
      if (!sat.enabled) {
        logger.debug(`Skipping disabled satellite ${sat.name} (${sat.catalog_number})`)
        continue
      }

      logger.debug(`Predicting for satellite ${sat.name} (${sat.catalog_number})`)

      const predictions = getPredictions(
        sat.tle,
        location.lat, location.lon, location.alt,
        predict_start,
        dayjs(predict_start).add('1', 'days').valueOf(),
        min_elevation,
        5
      )

      const start_end_elevation = db.getSetting('start_end_elevation') || 5

      //for each prediction, offset it until it's between start_end_elevation

      for (let prediction of predictions) {
        let startTime = prediction.start;

        let minelev = 0
        do {
          startTime += 5000;
          minelev = jspredict.observe(sat.tle, [location.lat, location.lon, location.alt], startTime).elevation
        } while (minelev < start_end_elevation)
        //logger.debug(`offsetting prediction start time by ${prediction.start-startTime} ms, min elev ${minelev}`)
        prediction.start = startTime
      }

      for (let prediction of predictions) {
        let startTime = prediction.start;
        let endTime = prediction.end;

        let minelev = 0
        do {
          endTime -= 5000;
          minelev = jspredict.observe(sat.tle, [location.lat, location.lon, location.alt], endTime).elevation
        } while (minelev < start_end_elevation)
        //logger.debug(`offsetting prediction start time by ${prediction.end-endTime} ms, min elev ${minelev}`)
        prediction.end = endTime
        prediction.duration = endTime - startTime
      }

      for (let prediction of predictions) {
        let satpos = jspredict.observe(prediction.tle, [location.lat, location.lon, location.alt], prediction.start)
        let sunpos = SunCalc.getPosition(prediction.start, satpos.latitude, satpos.longitude)
        sunpos.altitude = sunpos.altitude * 180 / Math.PI;
        sunpos.azimuth = sunpos.azimuth * 180 / Math.PI;
        prediction.sun_position_at_sat = sunpos
        prediction.sun_position = SunCalc.getPosition(prediction.start, location.lat, location.lon)
        delete prediction.tle
      }

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
  let transits = jspredict.transits(
    tle,
    [lat, lon, alt / 1000],
    start,
    end,
    min_elevation,
    max_predictions
  )
  return transits.map(x => { return { ...x, tle: tle } })
}

module.exports = { generateSchedule }