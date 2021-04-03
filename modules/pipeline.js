const logger = require('../logger')
const path = require('path')
const fs = require('fs')
const telegram = require('./telegram')
var mkfifoSync = require('mkfifo').mkfifoSync;
const { spawn } = require('child_process');
var glob = require("glob");
const imagemagickCli = require('imagemagick-cli');



module.exports = class Pipeline {

  constructor(baseband_file, satellite, prediction, direction, cwd, schedule_id) {
    this.baseband_file = baseband_file;
    this.satellite = satellite;
    this.prediction = prediction;
    this.direction = direction;
    this.cwd = cwd;
    this.schedule_id = schedule_id;
    this.handlers = {
      "C-BPSK-Demodulator": this.C_BPSK_Demodulator.bind(this),
      "QPSK-Demodulator": this.QPSK_Demodulator.bind(this),
      "NOAA-AVHRR-Decoder": this.NOAA_AVHRR_Decoder.bind(this),
      "MetOp-Decoder": this.MetOp_Decoder.bind(this),
      "MetOp-AVHRR-Decoder": this.MetOp_AVHRR_Decoder.bind(this),
      "METEOR-Demux": this.METEOR_Demux.bind(this),
      "METEOR-MSU-MR-Decoder": this.METEOR_MSU_MR_Decoder.bind(this),
      "Telegram-Post": this.Telegram_Post.bind(this)
    }
  }

  async run() {
    // try {
    let previous_result = { filename: this.baseband_file }

    for (let step of this.satellite.pipeline) {
      logger.debug(`[${this.schedule_id}] Running pipeline step: ${step.step}`)

      let handler = this.handlers[step.program.handler];
      let input_file = previous_result.filename

      if (!handler) throw new Error(`Handler ${step.program.handler} not found.`)

      previous_result = await handler(input_file, step.program.args)

      logger.debug(previous_result)
      if (step.program.args.delete)
        fs.unlinkSync(path.join(this.cwd, input_file))
    }

    fs.rmdirSync(this.cwd, { recursive: true })


  }

  thereIsLight() {
    return this.prediction.sun_position.altitude > 0
  }


  async DenoiseAndRotate(denoise) {

    let pngs = glob.sync(path.join(this.cwd, '*.png'))
    let command = ""

    if (denoise) command += " -median 3 "

    if (this.passDirection === 'N') command += " -rotate 180 "

    let workers = pngs.map(filename => imagemagickCli.exec(`convert ${filename} ${command} ${filename}-proc.jpg`).catch(err => logger.error(`Error processing image ${filename}: ${err}`)))
    await Promise.all(workers)
    return true

  }

  async Telegram_Post(input_file) {
    let filepath = path.join(this.cwd, input_file)
    logger.debug(`Posting image to telegram ${filepath}`)
    // logger.debug(`Posting image to telegram ${filepath}, args: ${JSON.stringify(args)}, pass data: ${JSON.stringify(passData)}`)
    let caption = `${this.satellite.name}, MEL ${this.prediction.maxElevation.toFixed(0)}`
    logger.debug(`Posted caption will be: ${caption}`)

    await telegram.postImage(filepath, caption)
  }

  async METEOR_Demux(input_file) {
    let command = "METEOR-Demux"
    let output_file = `meteor_demux_${Date.now()}`
    let pargs = [
      '-i', input_file,
      '-o', "met" //always use same prefix
    ]
    await this.GenericSpawner(command, pargs)
    return { filename: output_file }
  }

  async METEOR_MSU_MR_Decoder() {
    let command = "METEOR-MSU-MR-Decoder"
    let pargs = ["met-msu-mr.bin"]//always use same prefix as set in METEOR_Demux
    await this.GenericSpawner(command, pargs)

    let proc = await this.DenoiseAndRotate(this.direction)

    if (this.thereIsLight())
      return { filename: "MSU-MR-RGB-221-EQU.png" + (proc ? "-proc.jpg" : "") }
    else
      return { filename: "MSU-MR-5.png" + (proc ? "-proc.jpg" : "") }
  }

  async MetOp_AVHRR_Decoder(input_file) {
    let command = "MetOp-AVHRR-Decoder"
    // let output_file = `metop_decoder_${Date.now()}.bin`
    await this.GenericSpawner(command, [input_file]);
    let pngs = glob.sync(path.join(this.cwd, '*.png'))

    let proc = await this.DenoiseAndRotate(false.direction)

    if (this.thereIsLight(this.prediction))
      return { filename: "AVHRR-RGB-221-EQU.png" + (proc ? "-proc.jpg" : ""), filenames: pngs }
    else
      return { filename: "AVHRR-4.png" + (proc ? "-proc.jpg" : ""), filenames: pngs }

  }

  async MetOp_Decoder(input_file) {
    let command = "MetOp-Decoder"
    let output_file = `metop_decoder_${Date.now()}.bin`
    await this.GenericSpawner(command, [input_file, output_file])
    return { filename: output_file }
  }

  async NOAA_AVHRR_Decoder(input_file) {
    let command = "NOAA-AVHRR-Decoder"
    await this.GenericSpawner(command, [input_file])
    let pngs = glob.sync(path.join(this.cwd, '*.png'))

    let proc = await this.DenoiseAndRotate(this.direction)

    if (this.thereIsLight(this.prediction))
      return { filename: "AVHRR-RGB-221-EQU.png" + (proc ? "-proc.jpg" : ""), filenames: pngs }
    else
      return { filename: "AVHRR-4.png" + (proc ? "-proc.jpg" : ""), filenames: pngs }

  }

  async C_BPSK_Demodulator(input_file, args) {
    if (args.preset === 'noaa')
      return this.Aang23DemodsBase('C-BPSK-Demodulator-Batch', input_file, args.preset)
    else
      return this.Aang23DemodsBase('C-BPSK-Demodulator-Batch', input_file, args.preset, true)
  }

  async QPSK_Demodulator(input_file, args) {
    return this.Aang23DemodsBase('QPSK-Demodulator-Batch', input_file, args.preset)
  }

  async Aang23DemodsBase(command, input_file, preset, singlecore = false) {

    mkfifoSync(path.join(this.cwd, input_file) + 'fifo', 438); //438=0666

    logger.debug(`/usr/bin/zstd -d --stdout ${input_file} > ${input_file}fifo`)

    let zargs = ['-c', `/usr/bin/zstd -d --stdout ${input_file} > ${input_file}fifo`]

    this.GenericSpawner('/bin/sh', zargs)

    input_file += 'fifo'

    if (singlecore)
      return this.Aang23DemodsBaseSinglecore(command, input_file, preset)
    //Example filename: baseband_1610109078512_1701300_6000000.wav

    const [fn] = input_file.split('.') //remove extension
    const [, , , samplerate] = fn.split('_') // split by _, destructure ignoring 0, 1, 2
    logger.debug("Starting demod")

    let output_file = `demod_${Date.now()}.bin`
    //output_file = path.join(os.tmpdir(), output_file)

    let args = [
      '--preset', preset,
      '--input', input_file,
      '--output', output_file,
      '-s', samplerate
    ]

    await this.GenericSpawner(command, args)

    return { filename: output_file }
  }

  async Aang23DemodsBaseSinglecore(command, input_file, preset) {
    //Example filename: baseband_1610109078512_1701300_6000000.wav
    const [fn] = input_file.split('.') //remove extension
    const [, , , samplerate] = fn.split('_') // split by _, destructure ignoring 0, 1, 2
    logger.debug("Starting demod IN SINGLE CORE")

    let output_file = `demod_${Date.now()}.bin`
    //output_file = path.join(os.tmpdir(), output_file)

    let args = [
      '--cpu-list', '0',
      path.join('/usr/local/bin', command),
      '--preset', preset,
      '--input', input_file,
      '--output', output_file,
      '-s', samplerate
    ]

    await this.GenericSpawner('taskset', args, '/usr/bin')

    return { filename: output_file }
  }

  GenericSpawner(command, args, rundir = '/usr/local/bin') {

    logger.debug(command)
    logger.debug(args)

    if (command === '/bin/sh') rundir = ''

    return new Promise((resolve, reject) => {
      try {
        let stderr = ""
        let stdout = ""

        //      command = path.join(global.original_this.cwd, 'modules', 'decoders', command + '.exe')
        command = path.join(rundir, command)
        this.spwaned_process = spawn(command, args, { cwd: this.cwd, stdio: 'ignore', detached: true })

        // this.spwaned_process.stderr.on('data', () => { })
        // this.spwaned_process.stdout.on('data', () => { })

        this.spwaned_process.on('exit', (code) => {
          logger.info(`${command} ended with code ${code}.`)
          resolve({ code: code, stderr: stderr, stdout: stdout })
        })

        this.spwaned_process.on('error', (err) => {
          logger.info(`Error spawning ${command}: ${err}.`)
          reject({ error: err })
        })

      } catch (err) {
        reject({ error: err })
      }
    })
  }
}
