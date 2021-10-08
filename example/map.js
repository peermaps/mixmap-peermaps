var peermapsMixmap = require('../')
var eyros = require('eyros/2d')
var mixmap = require('mixmap')
var regl = require('regl')
var resl = require('resl')
var storage = require('../lib/http-storage')
 
var mix = mixmap(regl, {
  extensions: [ 'oes_element_index_uint', 'oes_texture_float', 'ext_float_blend' ]
})
var map = mix.create({ 
  //viewbox: [15.61,58.405,15.63,58.415], linköping
  //viewbox: [29.953483820459276, 31.219637265135706, 29.96598382045928, 31.23213726513571],
  //viewbox: [ +6.1, +46.15, +6.2, +46.25 ], // geneva
  //viewbox: [ 6.137747912317331, 46.19897573068894, 6.15024791231733, 46.21147573068893 ],
  //viewbox: [8.54,47.35,8.56,47.36], // zurich
  viewbox: [7.56,47.55,7.58,47.56], // basel
  //viewbox: [ 8.725407098121282, 47.445699373694936, 8.765407098121289, 47.46569937369492 ],
  //viewbox: [ 8.507787508144146, 47.40447215273824, 8.527787508144142, 47.414472152738234 ],
  //viewbox: [ 9.124885629229622, 47.34516891683048, 9.13488562922962, 47.35016891683048 ],
  //viewbox: [ 9.040710263885169, 47.37640325921034, 9.08071026388516, 47.396403259210324 ],
  //viewbox: [ 8.989019240920662, 47.252269647519384, 9.029019240920654, 47.272269647519366 ],
  // benchmark case:
  //viewbox: [ 9.086973311901822, 47.290818708062204, 9.126973311901814, 47.310818708062186 ],
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
    var pm = peermapsMixmap({ map, db, style })
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
