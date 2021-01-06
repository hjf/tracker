global.original_cwd;
global.original_cwd = process.cwd();
const fs = require("fs")
var express=require('express')
var app = express();
var path=require('path');
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

        const port = db.getSetting('http_port')
app.use(express.static(path.join(__dirname, 'static')));

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});
        app.get('/getGroundStationLocation', async (req, res) => {
          res.json(db.getSetting('ground_station_location'))
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

console.log(JSON.stringify(await db.getSatellites()))
        const location = db.getSetting('ground_station_location')
        const trackerController = new TrackerController(io, location);
        const radioController = new RadioController(io)

        const scheduleRunner = new ScheduleRunner(io, location, trackerController, radioController);

        trackerController.startPolling();

        await tleupdater.updateTLEs(false, io)
        await satscheduler.generateSchedule()

        ///////////////////
        await db.changeEventStatus(435, 'scheduled', null)
        scheduleRunner.processEvents()
        ////////////////////

        // console.log(JSON.stringify(passes[0],null,2))

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





 
