const logger = require('../logger')
const path = require('path')
const { spawn } = require('child_process')

// const AIRSPY_RX_EXECUTABLE = path.join(global.original_cwd, 'modules', 'airspyrx', 'airspy_rx.exe')
// const AIRSPY_RX_EXECUTABLE = '/usr/bin/airspy_rx'
// const AIRSPY_GPIO_EXECUTABLE = '/usr/bin/airspy_gpio'

// function ab2str(buf) {
//   return String.fromCharCode.apply(null, new Uint8Array(buf));
// }

module.exports = class RadioController {
  constructor (io, spyserver) {
    this.io = io
    this.busy = false
    this.currentprocess = null
    this.spyserver = spyserver
  }

  isBusy () { return this.busy }

  async startCapture (frequency, samplerate, durationMilliseconds, cwd) {
    return new Promise((resolve, reject) => {
      try {
        const stderr = ''
        const stdout = ''
        logger.debug('Starting baseband capture')

        const nsamples = (samplerate * (durationMilliseconds / 1000)).toFixed(0).toString() // samplerate x duration = n of samples to capture
        logger.debug(`Will capture ${nsamples} samples`)

        let filename = `baseband_${Date.now()}_${(frequency * 1000).toFixed(0)}_${samplerate}.zst`
        filename = path.join(filename)
        logger.info(`Starting capture with airspy_rx into file ${filename}`)

        // ./ ss_client - f 1694100000 - s 6000000 - r 10.42.42.133 - q 5556 iq - g 20
        const args = [
          '-f', (frequency * 1000000).toFixed(0), // frequency for airspy_rx is in mhz!
          // '-b', '1', // bias tee on
          '-g', '20', // gain mode "sensitivity", value 20
          '-n', nsamples,
          // '-t', '2', // sample type 2=INT16_IQ(default)
          '-s', samplerate.toString(),
          // '-r', filename,
          '-r', this.spyserver.host,
          '-q', this.spyserver.port.toString(), 'iq',
          '|',
          'zstd', '-o', filename
        ]

        const rawargs = ['-c', '/usr/local/bin/ss_client' + ' ' + args.join(' ')]
        console.log(rawargs)
        // this.currentprocess = spawn(AIRSPY_RX_EXECUTABLE, args, { cwd: cwd, stdio: 'ignore', detached: true })
        this.currentprocess = spawn('/bin/sh', rawargs, { cwd: cwd, stdio: 'ignore', detached: true })

        // this.currentprocess.stderr.on('data', () => { })
        // this.currentprocess.stdout.on('data', () => { })

        // this.currentprocess.stderr.on('data', (data) => {
        //   data = ab2str(data);
        //   // logger.debug(data);
        //   stderr += data
        // })
        // this.currentprocess.stdout.on('data', (data) => {
        //   data = ab2str(data);
        //   // logger.debug(data);
        //   stdout += data
        // })

        this.currentprocess.on('exit', (code) => {
          // try {
          //   exec(AIRSPY_GPIO_EXECUTABLE + ' -p 1 -n 13 -w 0 ')
          // } catch (err) {
          //   logger.error(err)
          // }

          logger.info(`airspy_rx ended with code ${code}.`)
          resolve({ filename: filename, stdout: stdout, stderr: stderr })//, stdout: stdout, stderr: stderr })
        })

        this.currentprocess.on('error', (err) => {
          logger.info(`Error spawning airspy_rx: ${err}.`)
          reject(new Error(err))
        })
      } catch (err) {
        reject(new Error(err))
      }
    })
  }

  async stopCapture () {

  }
}
