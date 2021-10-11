var peermapsMixmap = require('../')
var eyros = require('eyros/2d')
var mixmap = require('mixmap')
var regl = require('regl')
var resl = require('resl')
//var storage = require('../lib/http-storage')
var storage = require('../lib/ipfs-storage')(
  //'ipfs:/ipfs/QmVCYUK51Miz4jEjJxCq3bA6dfq5FXD6s2EYp6LjHQhGmh'
  'http://bafybeidf5yn56cxk6zkyjmay4wigu2o7ynqh7q62z3kppag5v7jpqavy5q.ipfs.localhost:8080'
  //'https://ipfs.io/ipfs/QmVCYUK51Miz4jEjJxCq3bA6dfq5FXD6s2EYp6LjHQhGmh'
)
 
var mix = mixmap(regl, {
  extensions: [ 'oes_element_index_uint', 'oes_texture_float', 'ext_float_blend' ]
})
var map = mix.create({ 
  //viewbox: [15.61,58.405,15.63,58.415], linköping
  //viewbox: [29.953483820459276, 31.219637265135706, 29.96598382045928, 31.23213726513571],
  //viewbox: [ +6.1, +46.15, +6.2, +46.25 ], // geneva
  //viewbox: [ 6.137747912317331, 46.19897573068894, 6.15024791231733, 46.21147573068893 ],
  //viewbox: [8.54,47.35,8.56,47.36], // zurich
  //viewbox: [-149.89,61.213,-149.91,61.223], // anchorage
  viewbox: (function () {
    var x = location.hash.replace(/^#/,'')
    return x.length > 0
      ? unescape(x).split(',').map(parseFloat)
      : [7.56,47.55,7.58,47.56] // basel
  })(),
  backgroundColor: [0.82, 0.85, 0.99, 1.0],
  pickfb: { colorFormat: 'rgba', colorType: 'float32' }
})
window.map = map

resl({
  manifest: {
    style: { type: 'image', src: 'style.png' },
    wasmSource: { type: 'binary', src: 'eyros2d.wasm' },
  },
  onDone: async function({ style, wasmSource }) {
    var db = await eyros({
      storage,
      wasmSource,
      //debug: function (msg) { console.log("[debug]", msg) }
    })
    var pm = peermapsMixmap({ map, db, storage, style })
    window.addEventListener('click', function (ev) {
      pm.pick({ x: ev.offsetX, y: ev.offsetY }, function (err, data) {
        console.log('pick', err, data)
      })
    })
  }
})

window.addEventListener('keydown', function (ev) {
  if (ev.code === 'Digit0') {
    map.setZoom(Math.min(6,Math.round(map.getZoom()+1)))
  } else if (ev.code === 'Minus') {
    map.setZoom(map.getZoom()-1)
    console.log(map.getZoom())
  } else if (ev.code === 'Equal') {
    map.setZoom(map.getZoom()+1)
    console.log(map.getZoom())
  }
})

window.addEventListener('resize', function (ev) {
  map.resize(window.innerWidth, window.innerHeight)
})
 
document.body.style.margin = '0px'
document.body.style.overflow = 'hidden'
document.body.appendChild(mix.render())
document.body.appendChild(map.render({ width: window.innerWidth, height: window.innerHeight }))
