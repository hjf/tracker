const fs = require("fs")
var app = require('express')();
var http = require('http').createServer(app);
var io = require('socket.io')(http, {
  cors: {
    origin: '*',
  }
});

//my modules
const db = require('./db.js')
const tleupdater = require('./modules/tleupdater');
const satscheduler = require('./modules/satscheduler')
const logger = require('./logger');
const socketioTransport = require('./modules/logger-transport-socketio');

//my classes
const ScheduleRunner = require('./modules/schedulerunner');
const TrackerController = require('./modules/tracker-controller');
const RadioController = require('./modules/radio-controller');

(
  async function () {
    try {

      const port = await db.getSetting('http_port')
      app.get('/', (req, res) => {
        res.send('Hello World!')
      })

      app.get('/getGroundStationLocation', async (req, res) => {
        res.json(await db.getSetting('ground_station_location'))
      })

      app.get('/upcomingPasses', async (req, res) => {
        res.json(await db.getScheduledEvents('satellite_pass'))
      })

      app.get('/getSatellites', async (req, res) => {
        res.json(await db.getSatellites())
      })

      http.listen(port, () => { logger.info(`Listening at http://localhost:${port}`) })

      //sends log to web in real time
      logger.add(new socketioTransport({ io: io, level: 'debug', 'timestamp': true }))


      const location = await db.getSetting('ground_station_location')
      const trackerController = new TrackerController(io, location);
      const radioController = new RadioController(io)

      const scheduleRunner = new ScheduleRunner(io, location, trackerController, radioController);

      trackerController.startPolling();

      await tleupdater.updateTLEs(false, io)
      await satscheduler.generateSchedule()

      //call the schedule runner every 10 seconds
      setInterval(() => { scheduleRunner.processEvents() }, 10000);

      //check if TLEs need updating every day
      setInterval(() => { tleupdater.updateTLEs(false, io) }, 86400000);
    }

    catch (err) {
      console.error(err)
      process.exit()
    }
  }());





