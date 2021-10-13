var rx = 0

module.exports = function (root) {
  var controllers = {}
  var storageFn = function (name) {
    var data = null
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
        if (data === null) getData(f, cb)
        else cb(null, data.length)
      },
      read: function f (offset, length, cb) {
        //console.log(name,'read',offset,length)
        if (data === null) getData(f, offset, length, cb)
        else if (offset === 0 && length === data.length) {
          cb(null, data)
        } else {
          cb(null, data.subarray(offset,offset+length))
        }
      },
    }
    async function getData (f, ...args) {
      console.log('get',name)
      if (controllers[name] === null) { // cancelled request
        storageFn.activeRequests.delete(name)
        delete controllers[name]
        return
      } else if (controllers[name]) {
        return // already open
      }
      var opts = {}
      if (typeof AbortController !== 'undefined') {
        controllers[name] = new AbortController
        opts.signal = controllers[name].signal
      }
      var to = setTimeout(function () {
        if (controllers[name]) controllers[name].abort()
        delete controllers[name]
      }, 5_000)
      //console.log('open',name)
      storageFn.activeRequests.add(name)
      try {
        data = Buffer.from(await (await fetch(root + '/' + name, opts)).arrayBuffer())
        rx += data.length
      } catch (err) {
        console.log('CAUGHT',err,controllers[name] === null)
        if (controllers[name] === null) {
          storageFn.activeRequests.delete(name)
        } else {
          setTimeout(function () {
            if (controllers[name] !== null) {
              console.log('retry', name)
              getData(f, ...args) // retry
            }
          }, 5_000)
        }
      }
      console.log('complete',name)
      clearTimeout(to)
      delete controllers[name]
      if (data) {
        storageFn.activeRequests.delete(name)
        f.apply(null, args)
        console.log((rx/1024/1024).toFixed(1) + ' M')
      }
    }
  }
  storageFn.cancel = function (name) {
    storageFn.activeRequests.delete(name)
    if (controllers[name]) {
      controllers[name].abort()
    }
    controllers[name] = null
  }
  storageFn.activeRequests = new Set
  return storageFn
}
