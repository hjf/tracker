const logger = require('../logger')
const jspredict = require('jspredict')
const Serialport = require('serialport')
const Readline = require('@serialport/parser-readline')
const sem = require('semaphore')(1);

module.exports = class TrackerController {
  constructor(io, location) {
    this.io = io
    this.location = [location.lat, location.lon, location.alt / 1000]
    this.rotor_status = { "azimuth": 0, "elevation": 0, "target_azimuth": 0, "target_elevation": 0 }
    this.satellite = null
    this.drivers_power = "unknown"
    this.initializeSerialPort();
    this.responseHandler = null
    this.last_poll = 0
    this.last_azimuth = 0
    this.azimuth_offset = 0
  }

  serialWrite(message) {
    return new Promise((resolve, reject) => {
      sem.take(() => {
        let to = setTimeout(() => {
          sem.leave();
          reject('timeout')
        }, 3000)

        this.responseHandler = (res) => {
          if (!to || to._destroyed) return
          clearTimeout(to)
          sem.leave()
          resolve(res)
        }

        this.port.write(message.trim() + '\n', (err) => {
          if (err) {
            if (to && to._destroyed === false)
              clearTimeout(to)
            logger.error('Serial this.port error: ', err.message)
            sem.leave();
            reject(err)
          }
        })
      })
    })
  }

  initializeSerialPort() {
    this.port = new Serialport('/dev/ttyUSB0', { baudRate: 9600, autoOpen: false })
    this.port.on('error', (err) => { logger.error('Serial port error: ' + err) })
    this.port.on('closed', () => { logger.error(`Serial port closed, will try reopening in 10 seconds.`); setTimeout(() => { this.initializeSerialPort(); }, 10000) })
    this.parser = this.port.pipe(new Readline({ delimiter: '\r\n' }))
    this.parser.on('data', (data) => this.processSerialPortData(data))
    this.port.open((err) => {
      if (!err)
        return;

      logger.error(`Could not open serial port: ${err.message}. Will retry in 10 seconds.`)
      setTimeout(this.initializeSerialPort, 10000); // next attempt to open after 10s
    });
  }

  processSerialPortData(data) {
    try {
      if (this.responseHandler) {
        this.responseHandler(data.trim())
        this.responseHandler = null
      }
      else
        //if(data.trim()!=='ok')  because firmware error that returns ok twice
        if (data.trim() !== 'ok') logger.warn('Data arrived on serial port, but there was no handler')

    } catch (err) {
      logger.error(err)
    }

  }

  startPolling() {
    logger.debug(`Starting rotor polling`)


    let handleM114 = (data) => {
      if (this.io) {
        let [, , currentAzimuth, , targetAzimuth, , currentElevation, , targetElevation, , driversPower] = data.split(" ");

        if (isNaN(currentAzimuth) || isNaN(targetAzimuth) || isNaN(currentElevation) || isNaN(targetElevation))
          return

        this.last_poll = Date.now()

        currentAzimuth /= 10;
        currentElevation /= 10;
        targetAzimuth /= 10;
        targetElevation /= 10;

        this.drivers_power = driversPower

        let status = {
          azimuth: currentAzimuth,
          elevation: currentElevation,
          target_azimuth: targetAzimuth,
          target_elevation: targetElevation,
          drivers_power: driversPower,
          satellite: this.satellite,
          last_poll: this.last_poll
        }

        this.io.emit('tracker', status)
      }
    }


    this.pollingHandler = setInterval(() => {
      this.serialWrite('M114').then(handleM114).catch(logger.error)
    }, 5000);
  }

  startTracking(satellite, timeout) {
    logger.info(`Starting to track satellite ${satellite.name} (${satellite.catalog_number})`)

    let tracker_timeout = timeout

    if (!tracker_timeout) {
      tracker_timeout = 15 * 60 * 1000;
      logger.warn(`Warning: Timeout not specified, using the default of 15 minutes.`)
    }

    this.satellite = satellite

    this.intervalHandler = setInterval(() => {
      let observation = jspredict.observe(satellite.tle, this.location)
      let el = observation.elevation
      let az = observation.azimuth

      if (az === 0)
        az = 0.1;//never allow it to be 0. at least 0.1 degree, see explanation below

      //this allows the rotor to go from, say, 1.2 degrees to 359.9 degrees
      // by offsetting the reading by 360. 359.9->1.2 becomes 359.9->(360+1.2) = 361.2
      if (this.azimuth_offset === 0 && az < 10 && this.last_azimuth > 350)
        this.azimuth_offset = 360

      //and this does the opposite, a jump from 1.2 to 359.9 becomes 1.2->359.9-360=>-0.1
      //this adds an extra check that last_azimuth should never be 0 (parked position)
      //because it would always take the "short route" and may get tangled with the antenna wires
      else if (this.azimuth_offset === 0 && az > 350 && this.last_azimuth < 10 && this.last_azimuth != 0)
        this.azimuth_offset = -360

      //save the real value of az
      this.last_azimuth = az

      el = (el * 10).toFixed(0)
      az = ((az + this.azimuth_offset) * 10).toFixed(0)

      this.serialWrite(`G01 A${az} E${el} F-1`)
        .then(() => { })
        .catch(() => { })

    }, 1000);

    setTimeout(() => { this.stopTracking() }, tracker_timeout)
  }

  stopTracking() {
    logger.debug(`Stopping tracking`)

    clearInterval(this.intervalHandler)
    this.last_azimuth = 0
    this.azimuth_offset = 0

    this.satellite = null
    this.park()

  }

  park() {
    return new Promise((resolve, reject) => {
      logger.debug(`parking rotor`)

      if (this.satellite) {
        reject(`Currently tracking ${this.satellite.name}`)
      } else {
        this.serialWrite(`G01 A0 E0 F-1`)
          .then(() => { resolve("OK") })
          .catch(reject)
      }
    })
  }

  getStatus() {
    return {
      "satellite": this.satellite,
      "azimuth": this.rotor_status.azimuth / 10,
      "elevation": this.rotor_status.elevation / 10,
      "target_azimuth": this.rotor_status.target_azimuth / 10,
      "target_elevation": this.rotor_status.target_elevation / 10,
      "last_poll": this.last_poll,
      "drivers_power": this.drivers_power,

    }
  }
}
