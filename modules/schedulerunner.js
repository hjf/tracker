const logger = require('../logger')
const db = require('../db.js');
const { identity } = require('lodash');

//https://stackoverflow.com/questions/3733227/javascript-seconds-to-minutes-and-seconds
function fmtMSS(s) { return (s - (s %= 60)) / 60 + (9 < s ? ':' : ':0') + s }


module.exports = class ScheduleRunner {
  constructor(io, location, trackerController, radioController) {
    this.io = io;
    this.location = location;
    this.trackerController = trackerController;
    this.radioController = radioController;
    this.busy = false
  }

  async processEvents() {

    try {
      if (this.busy) throw new Error(`Event processor was called while the previous run wasn't finished.`)

      this.busy = true

      logger.debug("Schedule runner started")

      const events = await db.getScheduledEventsToRun()

      if (events.length === 0) {
        setTimeout(() => { logger.debug("No pending scheduled events") }, 10)
        return false
      }

      logger.debug(`Starting to process ${events.length} event${events.length === 1 ? '.' : 's.'}`)


      for (let event of events) {
        logger.debug(`Processing event #${event.schedule_id}, of type ${event.schedule_type}`)
        let action = event.action
        switch (event.schedule_type) {
          case ('satellite_pass'):
            let end = new Date(action.prediction.end)

            //first check if the event shouldn't already been finished
            if (end < Date.now()) {
              await this.eventTooLate(event, end)
              break
            }

            //then check if the tracker isn't busy with another satellite
            if (this.trackerController.getStatus().satellite !== null) {
              await db.changeEventStatus(event.schedule_id, 'overlap', { error: `Tracker was busy with another satellite.` })
              break
            }

            //then check if the radio is free
            if (this.radioController.isBusy()) {
              await db.changeEventStatus(event.schedule_id, 'overlap', { error: `Radio was busy?` })
              break
            }

            //ok we can continue
            this.eventRunning(event)
            let duration = action.prediction.duration

            //naive algorithm to decide if N or S
            let direction = action.prediction.minAzimuth < 270 && action.prediction.minAzimuth >= 90 ? 'N' : 'S'

            logger.info(`Pass duration is ${fmtMSS(duration / 1000)}, max elevation: ${action.prediction.maxElevation}, direction: ${direction === 'N' ? 'Northbound' : 'Southbound'}.`)

            //start tracking
            logger.debug("Starting tracker")
            this.trackerController.startTracking(action.satellite, duration)
            logger.debug("Starting capture")
            let capture = this.radioController.startCapture(action.satellite.frequency, action.satellite.samplerate, duration)

            capture
              .then(res => {
                let baseband_file = res.filename
                
                logger.info(`Event #${event.schedule_id} ended successfully.`)
                db.changeEventStatus(event.schedule_id, 'done', res)
              })
              .catch(err => {
                logger.error(`Event #${event.schedule_id} failed with error: ${JSON.stringify(err)}`)
                db.changeEventStatus(event.schedule_id, 'error', err)
              })


            break
          default:
            this.eventNotRecognized(event)
        }
      }

    } catch (err) {
      logger.error(err)
    }
    finally {
      this.busy = false
    }
  }


  async eventTooLate(event, expected_end_time) {
    let error = `Event #${event.schedule_id} was run too late. Expected end time was ${expected_end_time.toUTCString()}, but it was run at ${(new Date()).toUTCString()}.`
    logger.error(error)
    db.changeEventStatus(event.schedule_id, 'late', { error: error })
  }

  async eventNotRecognized(event) {
    let error = `Schedule type ${event.schedule_type} not recognized.`
    logger.error(error)
    db.changeEventStatus(event.schedule_id, 'failed', { error: error })
  }

  async eventRunning(event) {
    logger.debug(`Marking event #${event.schedule_id} as running`)
    db.changeEventStatus(event.schedule_id, 'running', { start_time: Date.now() })
  }
}

