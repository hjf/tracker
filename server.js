global.original_cwd = process.cwd()
const express = require('express')
const app = express()
const path = require('path')
const http = require('http').createServer(app)
const io = require('socket.io')(http, {
  cors: {
    origin: '*'
  }
})

// my modules
const db = require('./db.js')
const tleupdater = require('./modules/tleupdater')
const satscheduler = require('./modules/satscheduler')
const logger = require('./logger')
const SocketIoTransport = require('./modules/logger-transport-socketio')
const SQLiteTransport = require('./modules/logger-transport-sqlite')

// my classes
const ScheduleRunner = require('./modules/schedulerunner')
const TrackerController = require('./modules/tracker-controller')
const RadioController = require('./modules/radio-controller');

(
  async function() {
    try {
      const port = db.getSetting('http_port')
      app.use(express.static(path.join(__dirname, 'static')))

      app.get('/', function (req, res) {
        res.sendFile(path.join(__dirname, 'static', 'index.html'))
      })
      app.get('/getGroundStationLocation', async (req, res) => {
        res.json(db.getSetting('ground_station_location'))
      })

      app.get('/upcomingPasses', async (req, res) => {
        res.json(await db.getScheduledEvents('satellite_pass'))
      })

      app.get('/setPassStatus', async (req, res) => {
        const scheduleId = req.query.id
        const runStatus = req.query.run_status

        const dbres = await db.changeEventStatus(scheduleId, runStatus, { status: 'changed by user' })
        res.json({ dbres: dbres })
      })

      app.get('/getSatellites', async (req, res) => {
        res.json(await db.getSatellites())
      })

      app.get('/getLogs', async (req, res) => {
        res.json(await db.getLogs())
      })

      http.listen(port, () => { logger.info(`Listening at http://localhost:${port}`) })

      // sends log to web in real time
      logger.add(new SocketIoTransport({ io: io, level: 'debug', timestamp: true }))
      logger.add(new SQLiteTransport({ level: 'debug' }))

      const location = db.getSetting('ground_station_location')

      const trackerController = new TrackerController(io, location)
      const radioController = new RadioController(io)
      const scheduleRunner = new ScheduleRunner(io, location, trackerController, radioController)

      trackerController.startPolling()

      await tleupdater.updateTLEs(false, io)

      // call the schedule runner every 10 seconds
      setInterval(() => { scheduleRunner.processEvents() }, 10000)

      tleupdater.updateTLEs(false, io)
      satscheduler.generateSchedule()
      // check if TLEs need updating every day
      setInterval(() => {
        tleupdater.updateTLEs(false, io)
        satscheduler.generateSchedule()
      }, 21600000)

      app.get('/park', async (req, res) => {
        trackerController.park()
          .then(() => {
            res.json({ result: 'ok' })
          })
          .catch((err) => {
            res.status(500).send(err)
          })
      })
    } catch (err) {
      logger.error(err)
      process.exit()
    }
  }())
