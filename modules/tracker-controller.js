// const axios = require('axios')
const logger = require('../logger')
const jspredict = require('jspredict')
// axios.defaults.timeout = 500;
// let rotor_address = '10.42.42.115'
const SerialPort = require('serialport')
const port = new SerialPort('/dev/ttyUSB0', {
  baudRate: 9600
})
module.exports = class TrackerController {
  constructor(io, location) {
    this.io = io
    this.location = [location.lat, location.lon, location.alt / 1000]
    this.rotor_status = { "azimuth": 0, "elevation": 0, "target_azimuth": 0, "target_elevation": 0 }
    this.satellite = null
    this.startPolling()

    this.hold = false;
    port.on('data', function (data) {
      if (data === "ok")
        return
      const [, , acp, , atp, , ecp, , etp] = data.split(" ");

      if (isNaN(acp) || isNaN(atp) || isNaN(ecp) || isNaN(etp))
        return

      let status = {
        azimuth: acp,
        elevation: ecp,
        target_azimuth: atp,
        target_elevation: etp
      }
      console.log(status)
      if (this.io) this.io.emit('tracker', status)
    })
  }

  startPolling() {
    this.pollingHandler = setInterval(() => {
      if (this.hold) return;
      this.hold = true;
      port.write('M114', function (err) {
        if (err) { logger.error('Serial port error: ', err.message) }
      })
      setTimeout(() => { this.hold = false }, 100)
      // axios.get(`http://${rotor_address}/status`)
      //   .then(res => {
      //     this.rotor_status = res.data
      //     if (this.io) this.io.emit('tracker', this.getStatus())
      //   })
      //   .catch(() => {
      //     //logger.error(err)
      //   })
    }, 1000);
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
      if (this.hold) return;

      let observation = jspredict.observe(satellite.tle, this.location)
      let az = (observation.azimuth * 10).toFixed(0)
      let el = (observation.elevation * 10).toFixed(0)

      this.hold = true;
      port.write(`G01 A${az} E${el} F-1`, function (err) {
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
    clearInterval(this.intervalHandler)
    this.satellite = null
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