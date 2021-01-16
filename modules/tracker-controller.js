// const axios = require('axios')
const logger = require('../logger')
const jspredict = require('jspredict')
// axios.defaults.timeout = 500;
// let rotor_address = '10.42.42.115'
const Serialport = require('serialport')
const Readline = require('@serialport/parser-readline')
const sem = require('semaphore')(1);

module.exports = class TrackerController {
  constructor(io, location) {
    this.io = io
    this.location = [location.lat, location.lon, location.alt / 1000]
    this.rotor_status = { "azimuth": 0, "elevation": 0, "target_azimuth": 0, "target_elevation": 0 }
    this.satellite = null
    this.motors_powered = false
    this.initializeSerialPort();
    this.responseHandler = null
  }

  serialWrite(message) {
    return new Promise((resolve, reject) => {
      sem.take(() => {
        this.responseHandler = (res) => { sem.leave(); resolve(res) }
        this.setTimeout(() => { sem.leave(); reject('timeout') }, 100)

        this.port.write(message.trim() + '\n', (err) => {
          if (err) {
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
        logger.warn('Data arrived on serial port, but there was no handler')

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

        currentAzimuth /= 10;
        currentElevation /= 10;
        targetAzimuth /= 10;
        targetElevation /= 10;

        let status = {
          azimuth: currentAzimuth,
          elevation: currentElevation,
          target_azimuth: targetAzimuth,
          target_elevation: targetElevation,
          drivers_power: driversPower,
          satellite: this.satellite
        }

        this.io.emit('tracker', status)
      }
    }


    this.pollingHandler = setInterval(() => {
      this.serialWrite('M114').then(handleM114).catch(logger.error)
    }, 998);
  }

  startTracking(satellite, timeout) {
    this.motors_powered = true;
    logger.info(`Starting to track satellite ${satellite.name} (${satellite.catalog_number})`)

    let tracker_timeout = timeout

    if (!tracker_timeout) {
      tracker_timeout = 15 * 60 * 1000;
      logger.warn(`Warning: Timeout not specified, using the default of 15 minutes.`)
    }

    this.satellite = satellite

    this.intervalHandler = setInterval(() => {
      let observation = jspredict.observe(satellite.tle, this.location)
      let az = (observation.azimuth * 10).toFixed(0)
      let el = (observation.elevation * 10).toFixed(0)


      this.serialWrite(`G01 A${az} E${el} F-1`)
        .then(() => { })
        .catch(() => { })

    }, 1000);

    setTimeout(() => { this.stopTracking() }, tracker_timeout)
  }

  stopTracking() {
    logger.debug(`Stopping tracking`)

    clearInterval(this.intervalHandler)
    this.satellite = null
    this.park()

  }

  park() {
    return new Promise((resolve, reject) => {
      logger.debug(`parking rotor`)

      reject(`Currently tracking ${this.satellite.name}`)

      this.serialWrite(`G01 A0 E0 F-1`)
        .then(() => { resolve("OK") })
        .catch((err) => { reject(err) })
    })
  }

  getStatus() {
    return {
      "satellite": this.satellite,
      "azimuth": this.rotor_status.azimuth / 10,
      "elevation": this.rotor_status.elevation / 10,
      "target_azimuth": this.rotor_status.target_azimuth / 10,
      "target_elevation": this.rotor_status.target_elevation / 10
    }
  }
}
