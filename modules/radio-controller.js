const logger = require('../logger')
const path = require('path')
const fs = require('fs')
const os = require('os')
const process = require('process')
const { spawn } = require('child_process');
const { resolve } = require('path');
const { stdout } = require('process');


const AIRSPY_RX_EXECUTABLE = path.join(process.cwd(), 'modules', 'airspyrx', 'airspy_rx.exe')

module.exports = class RadioController {
  constructor(io) {
    this.io = io
    this.busy = false
    this.process = null
  }

  isBusy() { return this.busy }

  async startCapture(frequency, samplerate, duration_ms) {
    return new Promise((resolve, reject) => {
      try {

        let stderr = ""
        let stdout = ""
        logger.debug("Starting baseband capture")

        let nsamples = (samplerate * (duration_ms / 1000)).toFixed(0).toString() //samplerate x duration = n of samples to capture
        logger.debug(`Will capture ${nsamples} samples`)

        let filename = `baseband_${Date.now()}_${(frequency * 1000).toFixed(0)}_${samplerate}.wav`
        filename = path.join(os.tmpdir(), filename)
        logger.info(`Starting capture with airspy_rx into file ${filename}`)

        let args = [
          '-f', frequency.toString(), //frequency for airspy_rx is in mhz!
          '-b', '1', //bias tee on
          '-h', '20', //gain mode "sensitivity", value 20
          '-n', nsamples,
          '-t', '2', //sample type 2=INT16_IQ(default)
          '-r', filename
        ]

        this.process = spawn(AIRSPY_RX_EXECUTABLE, args)

        this.process.stderr.on('data', (data) => { stderr += data })
        this.process.stdout.on('data', (data) => { stdout += data })

        this.process.on('exit', (code) => {
          logger.info(`airspy_rx ended with code ${code}.`)
          resolve({ filename: filename, stdout: stdout, stderr: stderr })
        })

        this.process.on('error', (err) => {
          logger.info(`Error spawning airspy_rx: ${err}.`)
          reject({ error: err })
        })

      }
      catch (err) {
        reject(err)
      }
    })
  }

  async stopCapture() {

  }

}