require('core-js/features/string/replace-all')

  (async function () {
    const fs = require("fs")
    const jspredict = require('jspredict')
    const https = require("https")
    const request = require("request")
    const yargs = require('yargs/yargs')
    const { hideBin } = require('yargs/helpers')
    const CELESTRAK_BASE = 'https://www.celestrak.com/NORAD/elements/'
    const dayjs = require('dayjs')
    let settings = null
    try {

      const argv = yargs(hideBin(process.argv)).argv
      if (!argv.catalog) { throw new Error("Must specify a catalog number, example: --catalog=25544 for the ISS") }
      let refresh = argv.refresh ? argv.refresh : 1000
      //try to read config
      let config = fs.readFileSync("config.json")
      settings = JSON.parse(config)

      //check if tle folder exists
      if (!fs.existsSync('tle')) {
        console.log("Creating directory 'tle' ")
        fs.mkdirSync('tle')
      }

      let alltle = ''
      for (let filename of settings.tles) {
        let file = `tle/${filename}`

        await new Promise((resolve, reject) => {
          let fresh = true
          if (!fs.existsSync(file)) {
            console.log(`${file} does not exist, `)
            fresh = false
          } else if (Date.now() - fs.statSync(file).ctime > 86400000 * settings.tle_max_age) {
            console.log(`${file} exists but it's too old, `)
            fresh = false
          }

          if (!fresh) {
            let url = `${CELESTRAK_BASE}${filename}`;
            console.log(`Fetching from ${url}`)
            request(url)
              .on('error', (err) => reject(err))
              .on('complete', () => {
                console.log("Fetched OK")
                resolve()
              })
              .pipe(fs.createWriteStream(file))
          } else {
            console.log(`${filename} OK.`)
            resolve()
          }
        })
        alltle += fs.readFileSync(file)
      }

      re = new RegExp(`(.+\\n.+${argv.catalog}(?:U|C|S).+\\n.+\\n)`, 'gm')
      let reres = re.exec(alltle.replaceAll("\r\n", "\n"))
      let tle = reres[0]
      if (tle) {
        let satname = tle.split('\n')[0].trim()
        let qth = [settings.location.latitude, settings.location.longitude, settings.location.altitude / 1000]
        console.log(`Tracking ${satname}. Refreshing every ${refresh}ms, Ctrl-C to exit.`)
        track(tle, qth)
        setInterval(() => {
          track(tle, qth)
        }, refresh)


      } else {
        console.log(`${argv.catalog} not found the available TLE files.`)
      }

    }
    catch (err) {
      console.error(err)
      process.exit()
    }

    function track(tle, qth) {
      let obs = jspredict.observe(tle, qth)
      let timestamp = dayjs().format()
      console.log(`[${timestamp}]\tAZ: ${obs.azimuth.toFixed(1)}\tEL: ${obs.elevation.toFixed(1)}`)
    }
  }());

