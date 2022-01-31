var path = require('path')
path.posix = path // work-around for https://github.com/andrewosh/mountable-hypertrie/pull/5

var Hyperdrive = require('hyperdrive')
var hyperswarm = require('hyperswarm-web')
var RAM = require('random-access-memory')
var pump = require('pump')

var DEFAULT_SWARM_OPTS = {
  bootstrap: [ 'wss://swarm.cblgh.org' ]
}

module.exports = function (url, opts) {
  opts = opts || {}
  var debug = opts.debug || false
  var key = url.replace(/^hyper:[\/]*/,'')
  var drive = new Hyperdrive(RAM, key)
  var isOpen = false
  var openQueue = []
  function open() {
    isOpen = true
    for (var i = 0; i < openQueue.length; i++) {
      openQueue[i]()
    }
    openQueue = null
  }
  var swarm = hyperswarm(opts.swarmOpts || DEFAULT_SWARM_OPTS)
  drive.once('ready', function () {
    swarm.join(drive.discoveryKey)
  })
  swarm.on('connection', function (socket, info) {
    console.log('replicate starting with peer', info.host)
    pump(socket, drive.replicate(info.client), socket, function (err) {
      if (err) console.log('hyperdrive: pump ERROR', err.message)
    })
    if (debug) socket.on('data', function (data) {
      console.log('hyperdrive: data from peer', info.host, data)
    })
    socket.on('error', function (err) {
      console.log('hyperdrive: stream ERROR for peer', info.host, err.message)
    })
    if (!isOpen) open()
  })
  var storageFn = function (name) {
    return {
      write: function (offset, buf, cb) {
        cb(new Error('write not implemented'))
      },
      truncate: function (length, cb) {
        cb(new Error('truncate not implemented'))
      },
      del: function (cb) {
        cb(new Error('del not implemented'))
      },
      sync: function (cb) {
        cb(new Error('sync not implemented'))
      },
      length: function f (cb) {
        if (!isOpen) {
          return openQueue.push(function () { f(cb) })
        }
        drive.stat(name, { wait: true }, function (err, stat) {
          console.log('LENGTH',name,err&&err.message,stat)
          if (err) retry(function () { f(cb) })
          else cb(null, stat.size)
        })
      },
      read: function f (offset, length, cb) {
        if (!isOpen) {
          return openQueue.push(function () { f(offset, length, cb) })
        }
        drive.open(name, 'r', function g (err, fd) {
          console.log('OPEN',name,err&&err.message,fd)
          if (err) return retry(function () { f(offset, length, cb) })
          var buf = Buffer.alloc(length)
          drive.read(fd, buf, 0, length, offset, function (err) {
            if (err) return retry(function () { g(null, fd) })
            console.log('READ',name,err)
            cb(err, buf)
          })
        })
      },
    }
  }
  storageFn.getRootUrl = function () {
    return url
  }
  storageFn.setRootUrl = function () {
    // no op - changing url on a hyperdrive storage doesn't make sense
  }
  storageFn.destroy = function (name, cb) {
    console.log('destroy',name)
    // todo
    if (typeof cb === 'function') cb()
  }
  return storageFn
  function retry(f) {
    setTimeout(f, 1000)
  }
}
