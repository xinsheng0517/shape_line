'use strict';

// Materials describe appearance, never a whitelist of material combinations.
const SynthesisConfig = Object.freeze({
  layout: Object.freeze({slots:Object.freeze(['TL','BL','TR','BR']), clockwise:Object.freeze({TL:'TR',TR:'BR',BR:'BL',BL:'TL'})}),
  materials: Object.freeze([
    Object.freeze({id:'T',name:'梯形',color:'#58a6ff',outline:'trapezoid'}),
    Object.freeze({id:'C',name:'圆形',color:'#f2a93b',outline:'circle'}),
    Object.freeze({id:'S',name:'星形',color:'#c586ff',outline:'star'})
  ]),
  rules:Object.freeze([])
});
if (typeof module !== 'undefined' && module.exports) module.exports = SynthesisConfig;
