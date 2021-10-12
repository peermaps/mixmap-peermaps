module.exports = function (openStorage, hooks) {
  if (!hooks) hooks = {}
  return function (name) {
    var storage = openStorage(name)
    return {
      write: function (offset, buf, cb) {
        if (hooks.beforeWrite) hooks.beforeWrite(name, offset, buf)
        storage.write(offset, buf, function (err) {
          cb(err)
          if (hooks.afterWrite) hooks.afterWrite(name, err)
        })
      },
      truncate: function (length, cb) {
        if (hooks.beforeTruncate) hooks.beforeTruncate(name, length)
        storage.truncate(length, function (err) {
          cb(err)
          if (hooks.afterTruncate) hooks.afterTruncate(name, err)
        })
      },
      del: function (cb) {
        if (hooks.beforeDel) hooks.beforeDel(name)
        storage.del(function (err) {
          cb(err)
          if (hooks.afterDel) hooks.afterDel(name, err)
        })
      },
      sync: function (cb) {
        if (hooks.beforeSync) hooks.beforeSync(name)
        storage.sync(function (err) {
          cb(err)
          if (hooks.afterSync) hooks.afterSync(name, err)
        })
      },
      length: function f (cb) {
        if (hooks.beforeLength) hooks.beforeLength(name)
        storage.length(function (err, n) {
          cb(err, n)
          if (hooks.afterLength) hooks.afterLength(name, err, n)
        })
      },
      read: function f (offset, length, cb) {
        if (hooks.beforeRead) hooks.beforeRead(name, offset, length)
        storage.read(offset, length, function (err, buf) {
          cb(err, buf)
          if (hooks.afterRead) hooks.afterRead(name, err, buf)
        })
      }
    }
  }
}
