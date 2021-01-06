const logger = require('../logger')
const path = require('path')
const fs = require('fs')
const os = require('os')
const telegram = require('./telegram')

const { spawn } = require('child_process');
var glob = require("glob");
const { resolve } = require('path');

let cwd = ''

handlers = {
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
  return new Promise(async (resolve, reject) => {
    try {
      cwd = pcwd


      let previous_result = { filename: input_file }
      for (let step of satellite.pipeline) {
        console.log(step)
        logger.debug(`Running pipeline step: ${step.step}`)

        let handler = handlers[step.program.handler]
        let input_file = previous_result.filename
        if (!handler) throw new Error(`Handler ${step.program.handler} not found.`)

        previous_result = await handler(input_file, step.program.args, { satellite: satellite, prediction: prediction })

        console.log(previous_result)
        if (step.program.args.delete)
          fs.unlinkSync(path.join(pcwd, input_file))
      }

    }
    catch (err) {
      logger.error(err)
      reject(err)
    }
  })
}

async function Telegram_Post(input_file, args, passData) {
  filepath = path.join(cwd, input_file)
  logger.debug(`Posting image to telegram ${filepath}, args: ${JSON.stringify(args, null, 2)}, pass data: ${JSON.stringify(passData, null, 2)}`)
  let caption = `${passData.satellite.name}, MEL ${passData.prediction.maxElevation.toFixed(0)}`
  logger.debug(`Posted caption will be: ${caption}`)

  await telegram.postImage(filepath, caption)
}

async function METEOR_Demux(input_file, args) {
  let command = "METEOR-Demux"
  let output_file = `meteor_demux_${Date.now()}`
  let pargs = [
    '-i', input_file,
    '-o', "met" //always use same prefix
  ]
  await GenericSpawner(command, pargs)
  return { filename: output_file }
}

async function METEOR_MSU_MR_Decoder(input_file, args) {
  let command = "METEOR-MSU-MR-Decoder"
  let pargs = ["met-msu-mr.bin"]//always use same prefix as set in METEOR_Demux
  await GenericSpawner(command, pargs)

  //TODO: RGB file should only be returned during the day
  return { filename: "MSU-MR-RGB-221-EQU.png" }
}

async function MetOp_AVHRR_Decoder(input_file, args) {
  let command = "MetOp-AVHRR-Decoder"
  let output_file = `metop_decoder_${Date.now()}.bin`
  await GenericSpawner(command, [input_file]);
  let pngs = glob.sync(path.join(cwd, '*.png'))

  //TODO: RGB file should only be returned during the day
  return { filename: "AVHRR-RGB-221-EQU.png", filenames: pngs }
}

async function MetOp_Decoder(input_file, args) {
  let command = "MetOp-Decoder"
  let output_file = `metop_decoder_${Date.now()}.bin`
  await GenericSpawner(command, [input_file, output_file])
  return { filename: output_file }
}

async function NOAA_AVHRR_Decoder(input_file, args) {
  let command = "NOAA-AVHRR-Decoder"
  await GenericSpawner(command, [input_file])
  let pngs = glob.sync(path.join(cwd, '*.png'))

  //TODO: RGB file should only be returned during the day
  return { filename: "AVHRR-RGB-221-EQU.png", filenames: pngs }
}

async function C_BPSK_Demodulator(input_file, args) {
  return Aang23DemodsBase('C-BPSK-Demodulator-Batch', input_file, args.preset, 3000000)
}

async function QPSK_Demodulator(input_file, args) {
  return Aang23DemodsBase('QPSK-Demodulator-Batch', input_file, args.preset, 6000000)
}

async function Aang23DemodsBase(command, input_file, preset, sample_rate) {

  logger.debug("Starting demod")

  let output_file = `demod_${Date.now()}.bin`
  //output_file = path.join(os.tmpdir(), output_file)

  let args = [
    '--preset', preset,
    '--input', input_file,
    '--output', output_file,
    '-s', sample_rate
  ]



  await GenericSpawner(command, args)

  return { filename: output_file }

}

function GenericSpawner(command, args) {

  console.log(command)
  console.log(args)


  return new Promise(async (resolve, reject) => {
    try {
      let stderr = ""
      let stdout = ""

      //      command = path.join(global.original_cwd, 'modules', 'decoders', command + '.exe')
      command = path.join('/usr/local/bin', command)
      this.spwaned_process = spawn(command, args, { cwd: cwd })

      this.spwaned_process.stderr.on('data', (data) => { stderr += data })
      this.spwaned_process.stdout.on('data', (data) => { stdout += data })

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
