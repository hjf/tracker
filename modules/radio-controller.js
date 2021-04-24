const logger = require('../logger')
const path = require('path')
const { spawn, exec, execSync } = require('child_process')

// const AIRSPY_RX_EXECUTABLE = path.join(global.original_cwd, 'modules', 'airspyrx', 'airspy_rx.exe')
const AIRSPY_RX_EXECUTABLE = '/usr/bin/airspy_rx'
const AIRSPY_GPIO_EXECUTABLE = '/usr/bin/airspy_gpio'

// function ab2str(buf) {
//   return String.fromCharCode.apply(null, new Uint8Array(buf));
// }

module.exports = class RadioController {
  constructor (io, remoteProcessor) {
    this.io = io
    this.busy = false
    this.currentprocess = null
    this.remoteProcessor = remoteProcessor
  }

  isRemote () { return this.remoteProcessor && this.remoteProcessor.enabled }

  isBusy () { return this.busy }

  async startCapture (frequency, samplerate, durationMilliseconds, cwd) {
    return new Promise((resolve, reject) => {
      try {
        const stderr = ''
        const stdout = ''
        let filename = ''

        logger.debug('Starting baseband capture')

        const nsamples = (samplerate * (durationMilliseconds / 1000)).toFixed(0).toString() // samplerate x duration = n of samples to capture
        logger.debug(`Will capture ${nsamples} samples`)

        if (this.isRemote()) {
          logger.info(`Starting capture with airspy_rx into remote ${this.remoteProcessor.address}`)
        }
        filename = `baseband_${Date.now()}_${(frequency * 1000).toFixed(0)}_${samplerate}.zst`
        filename = path.join(filename)
        logger.info(`Starting capture with airspy_rx into file ${filename}`)

        let args = [
          '-f', frequency.toString(), // frequency for airspy_rx is in mhz!
          '-b', '1', // bias tee on
          '-h', '20', // gain mode "sensitivity", value 20
          '-n', nsamples,
          '-t', '2', // sample type 2=INT16_IQ(default)
          '-a', samplerate.toString(),
          // '-r', filename,
          '-r', '-',
          '-p', '1',
          '|'
          // ,'zstd', '-o', filename
        ]

        if (this.isRemote()) {
          args = [...args,
            'nc', '-u', this.remoteProcessor.address, this.remoteProcessor.slavePort
          ]
          const listeCommand = `ssh -f -p ${this.remoteProcessor.port} ${this.remoteProcessor.username}@${this.remoteProcessor.address} '/usr/bin/nc -u -l -p ${this.remoteProcessor.slavePort}  | /usr/bin/zstd -1 - -o ${filename}' `
          logger.debug(listeCommand)
          execSync(listeCommand)
          logger.debug('Remote listening OK')
        } else {
          args = [...args,
            'zstd', '-o', filename]
        }

        const rawargs = ['-c', AIRSPY_RX_EXECUTABLE + ' ' + args.join(' ')]
        // this.currentprocess = spawn(AIRSPY_RX_EXECUTABLE, args, { cwd: cwd, stdio: 'ignore', detached: true })
        this.currentprocess = spawn('/bin/sh', rawargs, { cwd: cwd, stdio: 'ignore', detached: true })

        this.currentprocess.on('exit', (code) => {
          try {
            exec(AIRSPY_GPIO_EXECUTABLE + ' -p 1 -n 13 -w 0 ')
          } catch (err) {
            logger.error(err)
          }

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
