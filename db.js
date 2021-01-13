const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs')
const path = require('path')

function getConnection() {
  return new Promise((resolve, reject) => {
    open({
      filename: path.join(global.original_cwd, 'tracker.sqlite'),
      driver: sqlite3.cached.Database
    })
      .then((db) => { resolve(db) })
      .catch((err) => { reject(err) })
  })
}

// returns the peding scheduled events 
async function getScheduledEvents(schedule_type) {
  let now = new Date().getTime();
  let db = await getConnection();
  let rv = []
  if (schedule_type)
    rv = await db.all(`SELECT * FROM schedule WHERE schedule_time > :schedule_time AND schedule_type= :schedule_type AND (run_status = 'scheduled' OR run_status='disabled') ORDER BY schedule_time ASC`, { ":schedule_time": now, ":schedule_type": schedule_type })
  rv = await db.all(`SELECT * FROM schedule WHERE schedule_time > :schedule_time  AND (run_status = 'scheduled' OR run_status='disabled') ORDER BY schedule_time ASC`, { ":schedule_time": now })

  return rv.map(x => { x.action = JSON.parse(x.action); return x })
}

async function getScheduledEventsToRun(schedule_type) {
  let now = new Date().getTime();
  let db = await getConnection();
  let rv = []

  if (schedule_type)
    rv = await db.all(`SELECT * FROM schedule WHERE schedule_time < :schedule_time AND schedule_type= :schedule_type AND run_status = 'scheduled' ORDER BY schedule_time ASC`, { ":schedule_time": now, ":schedule_type": schedule_type })
  else
    rv = await db.all(`SELECT * FROM schedule WHERE schedule_time < :schedule_time AND run_status = 'scheduled' ORDER BY schedule_time ASC`, { ":schedule_time": now })

  return rv.map(x => { x.action = JSON.parse(x.action); return x })
}

async function addScheduledEvent(schedule_type, schedule_time, action) {
  let db = await getConnection();

  return await db.run('INSERT INTO schedule (schedule_type, schedule_time, action, run_status) VALUES (:schedule_type , :schedule_time , :action , :run_satus)',
    {
      ":schedule_type": schedule_type,
      ":schedule_time": schedule_time,
      ":action": JSON.stringify(action),
      ":run_satus": "scheduled",
    })
}

async function deleteScheduledEvents(schedule_type) {
  let db = await getConnection();

  if (schedule_type)
    return (await db.run("DELETE FROM schedule WHERE schedule_type=:schedule_type AND run_status='scheduled'", { ":schedule_type": schedule_type })).changes
  return (await db.run("DELETE FROM schedule WHERE run_status='scheduled'")).changes
}

async function changeEventStatus(schedule_id, run_status, result) {
  let db = await getConnection();
  let res = await db.run('UPDATE schedule SET run_status = :run_status, result=:result where schedule_id = :schedule_id',
    { ":run_status": run_status, ":schedule_id": schedule_id, ":result": JSON.stringify(result) })
  return res.changes === 1;
}

async function getSatellites() {
  let db = await getConnection();
  let sats = await db.all(`SELECT * FROM satellites`)
  return sats.map(x => { x.pipeline = JSON.parse(x.pipeline); return x; })
}

async function updateTLE(catalog_number, tle) {
  let db = await getConnection();
  let now = new Date().getTime();
  let res = await db.run('UPDATE satellites SET tle=:tle, last_update=:last_update WHERE catalog_number=:catalog_number',
    { ":catalog_number": catalog_number, ":last_update": now, ":tle": tle })
  return res.changes === 1;
}

function getSetting(key) {
  let settings = JSON.parse(fs.readFileSync(path.join(global.original_cwd, 'settings.json')))
  return settings[key]
}

async function log(info) {
  let db = await getConnection();

  return await db.run('INSERT INTO logs (timestamp, level, service, message) VALUES (:timestamp , :level , :service , :message)',
    {
      ":timestamp": Date.now(),
      ":level": info.level,
      ":service": info.service,
      ":message": info.message,
    })
}

async function getLogs(limit = 50) {
  let db = await getConnection();
  return await db.all(`SELECT * FROM logs ORDER BY id DESC LIMIT :limit`, { ":limit": limit })
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
  getLogs: getLogs
}