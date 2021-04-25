const logger = require('../logger')
const db = require('../db.js')
const Pipeline = require('./pipeline')
const os = require('os')
const fs = require('fs')
const path = require('path')
// https://stackoverflow.com/questions/3733227/javascript-seconds-to-minutes-and-seconds
function fmtMSS (s) { return (s - (s %= 60)) / 60 + (s > 9 ? ':' : ':0') + s }
const util = require('util')
const exec = util.promisify(require('child_process').exec)

module.exports = class ScheduleRunner {
  constructor (io, location, trackerController, radioController, remoteProcessor) {
    this.io = io
    this.location = location
    this.trackerController = trackerController
    this.radioController = radioController
    this.busy = false
    this.remoteProcessor = remoteProcessor
  }

  isRemote () { return this.remoteProcessor && this.remoteProcessor.enabled }

  async processEvents () {
    try {
      if (this.busy) throw new Error('Event processor was called while the previous run wasn\'t finished.')

      this.busy = true
      const events = await db.getScheduledEventsToRun()

      if (events.length === 0) { return false }

      logger.debug(`Starting to process ${events.length} event${events.length === 1 ? '.' : 's.'}`)

      for (const event of events) {
        logger.debug(`Processing event #${event.schedule_id}, of type ${event.schedule_type}`)
        const action = event.action
        switch (event.schedule_type) {
          case ('satellite_pass'): {
            const end = new Date(action.prediction.end)

            // first check if the event shouldn't already been finished
            if (end < Date.now()) {
              await this.eventTooLate(event, end)
              break
            }

            // then check if the tracker isn't busy with another satellite
            if (this.trackerController.getStatus().satellite !== null) {
              await db.changeEventStatus(event.schedule_id, 'overlap', { error: 'Tracker was busy with another satellite.' })
              break
            }

            // then check if the radio is free
            if (this.radioController.isBusy()) {
              await db.changeEventStatus(event.schedule_id, 'overlap', { error: 'Radio was busy?' })
              break
            }

            // ok we can continue
            this.eventRunning(event)
            const duration = action.prediction.duration

            const cwd = path.join(os.tmpdir(), `tracker_event_${event.schedule_id}`)

            logger.info(`Working directory: ${cwd}`)

            if (this.isRemote()) {
              const mkdirCmd = `ssh -p ${this.remoteProcessor.port} ${this.remoteProcessor.username}@${this.remoteProcessor.address} 'mkdir -p ${cwd}' `
              logger.info(mkdirCmd)
              await exec(mkdirCmd)
            }

            if (!fs.existsSync(cwd)) {
              fs.mkdirSync(cwd)
            }

            logger.info(`Pass duration is ${fmtMSS((duration / 1000).toFixed(0))}, max elevation: ${action.prediction.maxElevation.toFixed(0)}, direction: ${action.prediction.direction === 'N' ? 'Northbound' : 'Southbound'}.`)

            // start tracking
            logger.debug('Starting tracker')
            this.trackerController.startTracking(action.satellite, duration)
            logger.debug('Starting capture')

            const capture = this.radioController.startCapture(action.satellite.frequency, action.satellite.samplerate, duration, cwd)

            capture
              .then(async (res) => {
                const basebandFile = res.filename
                logger.info('starting pipeline')
                try {
                  const pipeline = new Pipeline(basebandFile, action.satellite, action.prediction, cwd, event.schedule_id, this.remoteProcessor)
                  await pipeline.run()
                } catch (err) {
                  logger.error(err)
                }

                logger.info(`Event #${event.schedule_id} ended successfully.`)
                db.changeEventStatus(event.schedule_id, 'done', res)
              })
              .catch(err => {
                logger.error(`Event #${event.schedule_id} failed with error: ${JSON.stringify(err)}`)
                db.changeEventStatus(event.schedule_id, 'error', err)
              })

            break
          }
          default: {
            this.eventNotRecognized(event)
          }
        }
      }
    } catch (err) {
      console.error(err)
      logger.error(err)
    } finally {
      this.busy = false
    }
  }

  async eventTooLate (event, expectedEndTime) {
    const error = `Event #${event.schedule_id} was run too late. Expected end time was ${expectedEndTime.toUTCString()}, but it was run at ${(new Date()).toUTCString()}.`
    logger.error(error)
    db.changeEventStatus(event.schedule_id, 'late', { error: error })
  }

  async eventNotRecognized (event) {
    const error = `Schedule type ${event.schedule_type} not recognized.`
    logger.error(error)
    db.changeEventStatus(event.schedule_id, 'failed', { error: error })
  }

  async eventRunning (event) {
    logger.debug(`Marking event #${event.schedule_id} as running`)
    db.changeEventStatus(event.schedule_id, 'running', { start_time: Date.now() })
  }
}
