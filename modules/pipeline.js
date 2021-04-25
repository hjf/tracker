const logger = require('../logger')
const path = require('path')
const telegram = require('./telegram')
const { spawn } = require('child_process')
const util = require('util')
const exec = util.promisify(require('child_process').exec)
const glob = require('glob')
const imagemagickCli = require('imagemagick-cli')

module.exports = class Pipeline {
  isRemote () { return this.remoteProcessor && this.remoteProcessor.enabled }

  constructor (basebandFile, satellite, prediction, cwd, scheduleId, remoteProcessor) {
    this.baseband_file = basebandFile
    this.satellite = satellite
    this.prediction = prediction
    this.cwd = cwd
    this.schedule_id = scheduleId
    this.remoteProcessor = remoteProcessor
    this.handlers = {
      'C-BPSK-Demodulator': this.CBPSKDemodulator.bind(this),
      'QPSK-Demodulator': this.QPSKDemodulator.bind(this),
      'NOAA-AVHRR-Decoder': this.NOAAAVHRRDecoder.bind(this),
      'MetOp-Decoder': this.MetOpDecoder.bind(this),
      'MetOp-AVHRR-Decoder': this.MetOpAVHRRDecoder.bind(this),
      'METEOR-Demux': this.METEORDemux.bind(this),
      'METEOR-MSU-MR-Decoder': this.METEORMSUMRDecoder.bind(this),
      'Telegram-Post': this.TelegramPost.bind(this)
    }
  }

  async run () {
    logger.debug('REmote processor for pipeline')
    logger.debug(this.remoteProcessor)
    try {
      let previousResult = { filename: this.baseband_file }

      for (const step of this.satellite.pipeline) {
        logger.debug(`[${this.schedule_id}] Running pipeline step: ${step.step}`)

        const handler = this.handlers[step.program.handler]
        const inputFile = previousResult.filename

        if (!handler) throw new Error(`Handler ${step.program.handler} not found.`)

        previousResult = await handler(inputFile, step.program.args)

        logger.debug(previousResult)
        //        if (step.program.args.delete) { fs.unlinkSync(path.join(this.cwd, inputFile)) }
      }
    } finally {
      // fs.rmdirSync(this.cwd, { recursive: true })
    }
  }

  thereIsLight () {
    return this.prediction.sun_position.altitude > 0
  }

  async DenoiseAndRotate (denoise, direction) {
    if (this.isRemote()) {
      const scpcmd = `/usr/bin/scp -P ${this.remoteProcessor.port} ${this.remoteProcessor.username}@${this.remoteProcessor.address}:${this.cwd}/*.png ${this.cwd}`
      logger.debug(scpcmd)
      await exec(scpcmd)
    }
    const pngs = glob.sync(path.join(this.cwd, '*.png'))
    let command = ''

    if (denoise) command += ' -median 3 '

    if (direction === 'N') command += ' -rotate 180 '

    const workers = pngs.map(filename => imagemagickCli.exec(`convert ${filename} ${command} ${filename}-proc.jpg`).catch(err => logger.error(`Error processing image ${filename}: ${err}`)))
    await Promise.all(workers)
    return true
  }

  async TelegramPost (inputFile) {
    const filepath = path.join(this.cwd, inputFile)
    logger.debug(`Posting image to telegram ${filepath}`)
    // logger.debug(`Posting image to telegram ${filepath}, args: ${JSON.stringify(args)}, pass data: ${JSON.stringify(passData)}`)
    const caption = `${this.satellite.name}, MEL ${this.prediction.maxElevation.toFixed(0)}`
    logger.debug(`Posted caption will be: ${caption}`)

    await telegram.postImage(filepath, caption)
  }

  async METEORDemux (inputFile) {
    const command = 'METEOR-Demux'
    const outputFile = `meteor_demux_${Date.now()}`
    const pargs = [
      '-i', inputFile,
      '-o', 'met' // always use same prefix
    ]
    await this.GenericSpawner(command, pargs)
    return { filename: outputFile }
  }

  async METEORMSUMRDecoder () {
    const command = 'METEOR-MSU-MR-Decoder'
    const pargs = ['met-msu-mr.bin']// always use same prefix as set in METEOR_Demux
    await this.GenericSpawner(command, pargs)

    const proc = await this.DenoiseAndRotate(false, this.prediction.direction)

    if (this.thereIsLight()) { return { filename: 'MSU-MR-RGB-221-EQU.png' + (proc ? '-proc.jpg' : '') } } else { return { filename: 'MSU-MR-5.png' + (proc ? '-proc.jpg' : '') } }
  }

  async MetOpAVHRRDecoder (inputFile) {
    const command = 'MetOp-AVHRR-Decoder'
    // let outputFile = `metop_decoder_${Date.now()}.bin`
    await this.GenericSpawner(command, [inputFile])
    const pngs = glob.sync(path.join(this.cwd, '*.png'))

    const proc = await this.DenoiseAndRotate(false, this.prediction.direction)

    if (this.thereIsLight(this.prediction)) { return { filename: 'AVHRR-RGB-221-EQU.png' + (proc ? '-proc.jpg' : ''), filenames: pngs } } else { return { filename: 'AVHRR-4.png' + (proc ? '-proc.jpg' : ''), filenames: pngs } }
  }

  async MetOpDecoder (inputFile) {
    const command = 'MetOp-Decoder'
    const outputFile = `metop_decoder_${Date.now()}.bin`
    await this.GenericSpawner(command, [inputFile, outputFile])
    return { filename: outputFile }
  }

  async NOAAAVHRRDecoder (inputFile) {
    const command = 'NOAA-AVHRR-Decoder'
    await this.GenericSpawner(command, [inputFile])
    const pngs = glob.sync(path.join(this.cwd, '*.png'))

    const proc = await this.DenoiseAndRotate(true, this.prediction.direction)

    if (this.thereIsLight(this.prediction)) { return { filename: 'AVHRR-RGB-221-EQU.png' + (proc ? '-proc.jpg' : ''), filenames: pngs } } else { return { filename: 'AVHRR-4.png' + (proc ? '-proc.jpg' : ''), filenames: pngs } }
  }

  async CBPSKDemodulator (inputFile, args) {
    if (args.preset === 'noaa') { return this.Aang23DemodsBase('C-BPSK-Demodulator-Batch', inputFile, args.preset) } else { return this.Aang23DemodsBase('C-BPSK-Demodulator-Batch', inputFile, args.preset, true) }
  }

  async QPSKDemodulator (inputFile, args) {
    return this.Aang23DemodsBase('QPSK-Demodulator-Batch', inputFile, args.preset)
  }

  async Aang23DemodsBase (command, inputFile, preset, singlecore = false) {
    const fullpath = path.join(this.cwd, inputFile)
    const mkfifocmd = `/usr/bin/mkfifo -m 0666 ${fullpath}fifo`

    logger.info(mkfifocmd)
    if (this.isRemote()) {
      // execSync(`/usr/bin/ssh -p ${this.remoteProcessor.port} ${this.remoteProcessor.username}@${this.remoteProcessor.address} '${mkfifocmd}'`)
    } else {
      await exec(mkfifocmd)
    }

    logger.debug(`/usr/bin/zstd -d --stdout ${inputFile} > ${inputFile}fifo`)

    if (this.isRemote()) {
      // const zargs = [`-c -d --stdout ${inputFile} > ${inputFile}fifo`]

      // this.GenericSpawner('/usr/bin/zstd', zargs)
    } else {
      const zargs = ['-c', `/usr/bin/zstd -d --stdout ${inputFile} > ${inputFile}fifo`]

      this.GenericSpawner('/bin/sh', zargs)
      inputFile += 'fifo'
    }

    if (singlecore) { return this.Aang23DemodsBaseSinglecore(command, inputFile, preset) }
    // Example filename: baseband_1610109078512_1701300_6000000.wav

    const [fn] = inputFile.split('.') // remove extension
    const [, , , samplerate] = fn.split('_') // split by _, destructure ignoring 0, 1, 2
    logger.debug('Starting demod')

    const outputFile = `demod_${Date.now()}.bin`
    // outputFile = path.join(os.tmpdir(), outputFile)

    const args = [
      '--preset', preset,
      '--input', inputFile,
      '--output', outputFile,
      '-s', samplerate
    ]

    await this.GenericSpawner(command, args)

    return { filename: outputFile }
  }

  async Aang23DemodsBaseSinglecore (command, inputFile, preset) {
    // Example filename: baseband_1610109078512_1701300_6000000.wav
    const [fn] = inputFile.split('.') // remove extension
    const [, , , samplerate] = fn.split('_') // split by _, destructure ignoring 0, 1, 2
    logger.debug('Starting demod IN SINGLE CORE')

    const outputFile = `demod_${Date.now()}.bin`
    // outputFile = path.join(os.tmpdir(), outputFile)

    const args = [
      '--cpu-list', '0',
      path.join('/usr/local/bin', command),
      '--preset', preset,
      '--input', inputFile,
      '--output', outputFile,
      '-s', samplerate
    ]

    await this.GenericSpawner('taskset', args, '/usr/bin')

    return { filename: outputFile }
  }

  GenericSpawner (command, args, rundir = '/usr/local/bin') {
    logger.debug(command)
    logger.debug(args)

    if (command === '/bin/sh') rundir = ''

    return new Promise((resolve, reject) => {
      try {
        const stderr = ''
        const stdout = ''
        let spawnedProcess = null
        command = path.join(rundir, command)
        if (this.isRemote()) {
          args = [command, ...args]
          args = [`-p ${this.remoteProcessor.port} ${this.remoteProcessor.username}@${this.remoteProcessor.address} 'cd ${this.cwd} ; ${args.join(' ')}'`]
          command = '/usr/bin/ssh'
          logger.info(`!!!REMOTE COMMAND ${command} ${args}`)
          spawnedProcess = spawn(command, args, { cwd: this.cwd, stdio: 'ignore', detached: true, shell: true })
        } else {
          spawnedProcess = spawn(command, args, { cwd: this.cwd, stdio: 'ignore', detached: true })
        }

        spawnedProcess.on('exit', (code) => {
          logger.info(`${command} ended with code ${code}.`)
          resolve({ code: code, stderr: stderr, stdout: stdout })
        })

        spawnedProcess.on('error', (err) => {
          logger.info(`Error spawning ${command}: ${err}.`)
          reject(new Error(err))
        })
      } catch (err) {
        reject(new Error(err))
      }
    })
  }
}
