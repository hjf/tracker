const axios = require('axios')
const logger = require('../logger')
const jspredict = require('jspredict')
axios.defaults.timeout = 500;
let rotor_address = '10.42.42.115'

module.exports = class TrackerController {
  constructor(io, location) {
    this.io = io
    this.location = [location.lat, location.lon, location.alt / 1000]
    this.rotor_status = { "azimuth": 0, "elevation": 0, "target_azimuth": 0, "target_elevation": 0 }
    this.satellite = null
    this.startPolling()
  }

  startPolling() {
    this.pollingHandler = setInterval(() => {
      axios.get(`http://${rotor_address}/status`)
        .then(res => {
          this.rotor_status = res.data
          if (this.io) this.io.emit('tracker', this.getStatus())
        })
        .catch(() => {
          //logger.error(err)
        })
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
      let observation = jspredict.observe(satellite.tle, this.location)
      let az = (observation.azimuth * 10).toFixed(0)
      let el = (observation.elevation * 10).toFixed(0)
      axios.get(`http://${rotor_address}/set?g=G01 A${az} E${el} F-1`)
        .then(() => { })
        .catch(() => {
          //logger.error(err)
        })
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