const sqlite3 = require('sqlite3')
const { open } = require('sqlite')
const fs = require('fs')
const path = require('path')
const logger = require('./logger')
const DATABASE_VERSION = 1

const MIGRATION_SCRIPTS = {
  1: ['delete from logs', 'alter table logs add uuid string']
}

function getConnection () {
  return new Promise((resolve, reject) => {
    open({
      filename: path.join(global.original_cwd, 'tracker.sqlite'),
      driver: sqlite3.cached.Database
    })
      .then((db) => { resolve(db) })
      .catch((err) => { reject(err) })
  })
}

async function doMigrations () {
  logger.info('Checking migrations')
  try {
    const db = await getConnection()

    const checkVersionTableExists = await db.all("select name from sqlite_master where name='db_version';")
    if (checkVersionTableExists.length === 0) {
      logger.info('version table does not exist, creating')
      await db.run('create table db_version (version number)')
      await db.run('insert into db_version (version) values (0);')
    } else {
      logger.info('version table exists')
    }

    let currentVersion = (await db.all('select version from db_version'))[0].version
    logger.info(`current database version: ${currentVersion}`)

    while (currentVersion < DATABASE_VERSION) {
      currentVersion++
      logger.info(`Migrating to version ${currentVersion}`)
      await db.run('begin transaction;')
      try {
        for (const script of MIGRATION_SCRIPTS[currentVersion]) {
          logger.info(script)
          await db.run(script)
        }
        db.run(`update db_version set version = ${currentVersion};`)
        db.run('commit transaction;')
        logger.info(`Migrated to ${currentVersion}`)
      } catch (err) {
        await db.run('rollback;')
        logger.error('Migration failed')
        return false
      }
    }
  } catch (err) {
    logger.error(err)
    return false
  }
  return true
}

// returns the peding scheduled events
async function getScheduledEvents (scheduleType) {
  const now = new Date().getTime()
  const db = await getConnection()
  let rv = []
  if (scheduleType) { rv = await db.all('SELECT * FROM schedule WHERE schedule_time > :schedule_time AND schedule_type= :schedule_type AND (run_status = \'scheduled\' OR run_status=\'disabled\') ORDER BY schedule_time ASC', { ':schedule_time': now, ':schedule_type': scheduleType }) }
  rv = await db.all('SELECT * FROM schedule WHERE schedule_time > :schedule_time  AND (run_status = \'scheduled\' OR run_status=\'disabled\') ORDER BY schedule_time ASC', { ':schedule_time': now })

  return rv.map(x => { x.action = JSON.parse(x.action); return x })
}

async function getScheduledEventsToRun (scheduleType) {
  const now = new Date().getTime()
  const db = await getConnection()
  let rv = []

  if (scheduleType) { rv = await db.all('SELECT * FROM schedule WHERE schedule_time < :schedule_time AND schedule_type= :schedule_type AND run_status = \'scheduled\' ORDER BY schedule_time ASC', { ':schedule_time': now, ':schedule_type': scheduleType }) } else { rv = await db.all('SELECT * FROM schedule WHERE schedule_time < :schedule_time AND run_status = \'scheduled\' ORDER BY schedule_time ASC', { ':schedule_time': now }) }

  return rv.map(x => { x.action = JSON.parse(x.action); return x })
}

async function addScheduledEvent (scheduleType, scheduleTime, action) {
  const db = await getConnection()

  return await db.run('INSERT INTO schedule (schedule_type, schedule_time, action, run_status) VALUES (:schedule_type , :schedule_time , :action , :run_satus)',
    {
      ':schedule_type': scheduleType,
      ':schedule_time': scheduleTime,
      ':action': JSON.stringify(action),
      ':run_satus': 'scheduled'
    })
}

async function deleteScheduledEvents (scheduleType) {
  const db = await getConnection()

  if (scheduleType) { return (await db.run("DELETE FROM schedule WHERE schedule_type=:schedule_type AND run_status='scheduled'", { ':schedule_type': scheduleType })).changes }
  return (await db.run("DELETE FROM schedule WHERE run_status='scheduled'")).changes
}

async function changeEventStatus (scheduleId, runStatus, result) {
  const db = await getConnection()
  const res = await db.run('UPDATE schedule SET run_status = :run_status, result=:result where schedule_id = :schedule_id',
    { ':run_status': runStatus, ':schedule_id': scheduleId, ':result': JSON.stringify(result) })
  return res.changes === 1
}

async function getSatellites () {
  const db = await getConnection()
  const sats = await db.all('SELECT * FROM satellites')
  return sats.map(x => { x.pipeline = JSON.parse(x.pipeline); return x })
}

async function updateTLE (catalogNumber, tle) {
  const db = await getConnection()
  const now = new Date().getTime()
  const res = await db.run('UPDATE satellites SET tle=:tle, last_update=:last_update WHERE catalog_number=:catalog_number',
    { ':catalog_number': catalogNumber, ':last_update': now, ':tle': tle })
  return res.changes === 1
}

function getSetting (key) {
  const settings = JSON.parse(fs.readFileSync(path.join(global.original_cwd, 'settings.json')))
  return settings[key]
}

async function log (info) {
  const db = await getConnection()
  if (DATABASE_VERSION < 1) {
    return await db.run('INSERT INTO logs (timestamp, level, service, message) VALUES (:timestamp , :level , :service , :message  )',
      {
        ':timestamp': Date.now(),
        ':level': info.level,
        ':service': info.service,
        ':message': info.message
      })
  }
  return await db.run('INSERT INTO logs (timestamp, level, service, message, uuid) VALUES (:timestamp , :level , :service , :message , :uuid )',
    {
      ':timestamp': Date.now(),
      ':level': info.level,
      ':service': info.service,
      ':message': info.message,
      ':uuid': info.uuid
    })
}

async function getLogs (limit = 50) {
  const db = await getConnection()
  return await db.all('SELECT * FROM logs ORDER BY id DESC LIMIT :limit', { ':limit': limit })
}

module.exports = {
  getScheduledEvents: getScheduledEvents,
  changeEventStatus: changeEventStatus,
  getSatellites: getSatellites,
  updateTLE: updateTLE,
  getSetting: getSetting,
  addScheduledEvent: addScheduledEvent,
  deleteScheduledEvents: deleteScheduledEvents,
  getScheduledEventsToRun: getScheduledEventsToRun,
  log: log,
  getLogs: getLogs,
  doMigrations: doMigrations
}
