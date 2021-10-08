var rx = 0

module.exports = function (name) {
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
    try {
      data = Buffer.from(await (await fetch('db/' + name)).arrayBuffer())
      rx += data.length
    } catch (err) {
      console.log('CAUGHT',err)
    }
    f.apply(null, args)
    console.log((rx/1024/1024).toFixed(1) + ' M')
  }
}
