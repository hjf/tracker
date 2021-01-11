// const axios = require('axios')
const logger = require('../logger')
const jspredict = require('jspredict')
// axios.defaults.timeout = 500;
// let rotor_address = '10.42.42.115'
const Serialport = require('serialport')
const Readline = require('@serialport/parser-readline')

module.exports = class TrackerController {
  constructor(io, location) {
    this.io = io
    this.location = [location.lat, location.lon, location.alt / 1000]
    this.rotor_status = { "azimuth": 0, "elevation": 0, "target_azimuth": 0, "target_elevation": 0 }
    this.satellite = null
    this.motors_powered = false
    this.initializeSerialPort();

  }

  initializeSerialPort() {
    this.hold = false;
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
      data = data.trim()

      let [, , currentAzimuth, , targetAzimuth, , currentElevation, , targetElevation] = data.split(" ");

      if (isNaN(currentAzimuth) || isNaN(targetAzimuth) || isNaN(currentElevation) || isNaN(targetElevation))
        return

      currentAzimuth /= 10;
      currentElevation /= 10;
      targetAzimuth /= 10;
      targetElevation /= 10;

      //auto poweroff
      if (this.motors_powered &&
        currentAzimuth == 0 &&
        targetAzimuth == 0 &&
        currentElevation == 0 &&
        targetElevation == 0) {
        this.hold = true;
        this.port.write('M18\n', (err) => {
          this.motors_powered = false
          if (err) { logger.error('Error sending M18: ', err.message) }
        })
        setTimeout(() => { this.hold = false }, 100)
      }

      let status = {
        azimuth: currentAzimuth,
        elevation: currentElevation,
        target_azimuth: targetAzimuth,
        target_elevation: targetElevation,
        satellite: this.satellite
      }

      if (this.io) this.io.emit('tracker', status)
    } catch (err) {
      logger.error(err)
    }

  }

  startPolling() {
    logger.debug(`Starting rotor polling`)

    this.pollingHandler = setInterval(() => {
      if (this.hold) return;
      this.hold = true;
      this.port.write('M114\n', (err) => {
        if (err) { logger.error('Serial this.port error: ', err.message) }
      })
      setTimeout(() => { this.hold = false }, 100)
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
      if (this.hold) return;

      let observation = jspredict.observe(satellite.tle, this.location)
      let az = (observation.azimuth * 10).toFixed(0)
      let el = (observation.elevation * 10).toFixed(0)

      this.hold = true;
      this.port.write(`G01 A${az} E${el} F-1\n`, (err) => {
        if (err) { logger.error('Serial port error: ', err.message) }
      })
      setTimeout(() => { this.hold = false }, 100)
      // axios.get()
      //   .then(() => { })
      //   .catch(() => {
      //     //logger.error(err)
      //   })
    }, 1000);

    setTimeout(() => { this.stopTracking() }, tracker_timeout)
  }

  stopTracking() {
    logger.debug(`Stopping tracking`)

    clearInterval(this.intervalHandler)
    this.hold = true;
    this.port.write(`G01 A0 E0 F-1\n`, (err) => {
      if (err) { logger.error('Serial this.port error: ', err.message) }
    })
    setTimeout(() => { this.hold = false }, 100)
    this.satellite = null
  }

  park() {
    logger.debug(`parking rotor`)

    if (this.hold)
      return "serial port busy, retry"

    if (this.satellite)
      return `Currently tracking ${this.satellite.name}`

    this.hold = true;
    this.port.write(`G01 A0 E0 F-1\n`, (err) => {
      if (err) { logger.error('Serial this.port error: ', err.message) }
    })
    setTimeout(() => { this.hold = false }, 100)

    return "OK"

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
