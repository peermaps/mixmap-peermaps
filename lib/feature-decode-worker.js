var b4a = require('b4a')
var decode = require('georender-pack/decode')

module.exports = function (self) {
    self.addEventListener('message',function (e){
      var {queryIndex, rowCount, buffer} = e.data
      // buffer = b4a.from(buffer)
      buffer.readUInt8 = function (offset) {
        return buffer[offset]
      }
      buffer.readFloatLE = function (offset) {
        return b4a.readFloatLE(buffer, offset)
      }
      try {
        var decoded = decode([buffer])  
        postMessage({queryIndex, rowCount, buffer, decoded})
      }
      catch (err) {
        console.log(err)
      }
    })
}
