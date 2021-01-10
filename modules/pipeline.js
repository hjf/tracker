const logger = require('../logger')
const path = require('path')
const fs = require('fs')
const telegram = require('./telegram')

const { spawn } = require('child_process');
var glob = require("glob");
const imagemagickCli = require('imagemagick-cli');

let cwd = ''

let handlers = {
  "C-BPSK-Demodulator": C_BPSK_Demodulator,
  "QPSK-Demodulator": QPSK_Demodulator,
  "NOAA-AVHRR-Decoder": NOAA_AVHRR_Decoder,
  "MetOp-Decoder": MetOp_Decoder,
  "MetOp-AVHRR-Decoder": MetOp_AVHRR_Decoder,
  "METEOR-Demux": METEOR_Demux,
  "METEOR-MSU-MR-Decoder": METEOR_MSU_MR_Decoder,
  "Telegram-Post": Telegram_Post
}

module.exports = async function pipeline(input_file, satellite, prediction, direction, pcwd) {
  // try {
  cwd = pcwd
  let previous_result = { filename: input_file }

  for (let step of satellite.pipeline) {
    console.log(step)
    logger.debug(`Running pipeline step: ${step.step}`)

    let handler = handlers[step.program.handler]
    let input_file = previous_result.filename
    if (!handler) throw new Error(`Handler ${step.program.handler} not found.`)

    previous_result = await handler(input_file, step.program.args, { satellite: satellite, prediction: prediction, direction: direction })

    console.log(previous_result)
    if (step.program.args.delete)
      fs.unlinkSync(path.join(pcwd, input_file))
  }

  // }
  // catch (err) {
  //   logger.error(err)
  //   return (err)
  // }
}

function thereIsLight(prediction) {
  return prediction.sun_position.altitude > 5
}


async function DenoiseAndRotate(denoise, passDirection) {

  let pngs = glob.sync(path.join(cwd, '*.png'))
  let command = ""

  if (denoise) command += " -median 3 "

  if (passDirection === 'N') command += " -rotate 180 "

  let workers = pngs.map(filename => imagemagickCli.exec(`convert ${filename} ${command} ${filename}-proc.jpg`).catch(err => logger.error(`Error processing image ${filename}: ${err}`)))
  await Promise.all(workers)
  return true

}

async function Telegram_Post(input_file, args, passData) {
  let filepath = path.join(cwd, input_file)
  logger.debug(`Posting image to telegram ${filepath}, args: ${JSON.stringify(args)}, pass data: ${JSON.stringify(passData)}`)
  let caption = `${passData.satellite.name}, MEL ${passData.prediction.maxElevation.toFixed(0)}`
  logger.debug(`Posted caption will be: ${caption}`)

  await telegram.postImage(filepath, caption)
}

async function METEOR_Demux(input_file) {
  let command = "METEOR-Demux"
  let output_file = `meteor_demux_${Date.now()}`
  let pargs = [
    '-i', input_file,
    '-o', "met" //always use same prefix
  ]
  await GenericSpawner(command, pargs)
  return { filename: output_file }
}

async function METEOR_MSU_MR_Decoder(input_file, args, passData) {
  let command = "METEOR-MSU-MR-Decoder"
  let pargs = ["met-msu-mr.bin"]//always use same prefix as set in METEOR_Demux
  await GenericSpawner(command, pargs)

  let proc = await DenoiseAndRotate(true, passData.direction)

  if (thereIsLight(passData.prediction))
    return { filename: "MSU-MR-RGB-221-EQU.png" + (proc ? "-proc.jpg" : "") }
  else
    return { filename: "MSU-MR-5.png" + (proc ? "-proc.jpg" : "") }
}

async function MetOp_AVHRR_Decoder(input_file, args, passData) {
  let command = "MetOp-AVHRR-Decoder"
  // let output_file = `metop_decoder_${Date.now()}.bin`
  await GenericSpawner(command, [input_file]);
  let pngs = glob.sync(path.join(cwd, '*.png'))

  let proc = await DenoiseAndRotate(false, passData.direction)

  if (thereIsLight(passData.prediction))
    return { filename: "AVHRR-RGB-221-EQU.png" + (proc ? "-proc.jpg" : ""), filenames: pngs }
  else
    return { filename: "AVHRR-4.png" + (proc ? "-proc.jpg" : ""), filenames: pngs }

}

async function MetOp_Decoder(input_file) {
  let command = "MetOp-Decoder"
  let output_file = `metop_decoder_${Date.now()}.bin`
  await GenericSpawner(command, [input_file, output_file])
  return { filename: output_file }
}

async function NOAA_AVHRR_Decoder(input_file, args, passData) {
  let command = "NOAA-AVHRR-Decoder"
  await GenericSpawner(command, [input_file])
  let pngs = glob.sync(path.join(cwd, '*.png'))

  let proc = await DenoiseAndRotate(true, passData.direction)

  if (thereIsLight(passData.prediction))
    return { filename: "AVHRR-RGB-221-EQU.png" + (proc ? "-proc.jpg" : ""), filenames: pngs }
  else
    return { filename: "AVHRR-4.png" + (proc ? "-proc.jpg" : ""), filenames: pngs }

}

async function C_BPSK_Demodulator(input_file, args) {
  return Aang23DemodsBase('C-BPSK-Demodulator-Batch', input_file, args.preset)
}

async function QPSK_Demodulator(input_file, args) {
  return Aang23DemodsBase('QPSK-Demodulator-Batch', input_file, args.preset)
}

async function Aang23DemodsBase(command, input_file, preset) {
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

  await GenericSpawner(command, args)

  return { filename: output_file }
}

function GenericSpawner(command, args) {

  console.log(command)
  console.log(args)


  return new Promise((resolve, reject) => {
    try {
      let stderr = ""
      let stdout = ""

      //      command = path.join(global.original_cwd, 'modules', 'decoders', command + '.exe')
      command = path.join('/usr/local/bin', command)
      this.spwaned_process = spawn(command, args, { cwd: cwd })

      this.spwaned_process.stderr.on('data', () => { })
      this.spwaned_process.stdout.on('data', () => { })

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
