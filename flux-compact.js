(function(){
function $(s,r){return (r||document).querySelector(s)} function $$(s,r){return [...(r||document).querySelectorAll(s)]}
var crossVal=0,curve='smooth';
try{var sv=JSON.parse(localStorage.getItem('fluxSettings')||'{}');if(typeof sv.cross==='number')crossVal=sv.cross;if(sv.curve)curve=sv.curve;}catch(e){}
function save(){try{localStorage.setItem('fluxSettings',JSON.stringify({cross:crossVal,curve:curve,quant:$('#quantize')?$('#quantize').checked:true}))}catch(e){}}
function applyCross2(){var h=$('#cross');if(h)h.value=crossVal;var cap=$('#xfCap');if(cap)cap.style.left=((crossVal+100)/2)+'%';var v=$('#xfVal');if(v)v.textContent=(Math.abs(crossVal)<2?'CENTER ':crossVal<0?'LEFT ':'RIGHT ')+Math.round(crossVal);try{if(typeof ready!=='undefined'&&!ready)return;if(typeof decks==='undefined')return;var x=crossVal/100,l,r;if(curve==='cut'){l=x<.15?1:0;r=x>-.15?1:0;if(Math.abs(x)<=.15){l=1;r=1}}else if(curve==='sharp'){var t=Math.pow(Math.abs(x),.35)*(x<0?-1:1);l=Math.cos((t+1)*Math.PI/4);r=Math.cos((1-t)*Math.PI/4)}else{l=Math.cos((x+1)*Math.PI/4);r=Math.cos((1-x)*Math.PI/4)}decks.forEach(function(d){if(d.xGain)d.xGain.gain.value=d.x==='left'?l:d.x==='right'?r:1});}catch(e){}}
window.applyCross=applyCross2;window._setFluxCross=function(v){crossVal=Math.max(-100,Math.min(100,Math.round(v)));applyCross2();save();};
function setupCross(){var old=$('#cross');if(!old||$('#xfader'))return;old.outerHTML='<div class="xfader" id="xfader"><div class="xfCenter"></div><div class="xfCap" id="xfCap"></div></div><div class="xfLbl"><span class="small">\u25c0 1/3</span><span class="small" id="xfVal">CENTER 0</span><span class="small">2/4 \u25b6</span></div><input id="cross" type="hidden" value="0">';var xf=$('#xfader');function from(e){var r=xf.getBoundingClientRect();window._setFluxCross(((e.clientX-r.left)/r.width)*200-100)}xf.addEventListener('pointerdown',function(e){e.preventDefault();try{xf.setPointerCapture(e.pointerId)}catch(_){}from(e);var mv=function(ev){from(ev)};var up=function(){xf.removeEventListener('pointermove',mv);xf.removeEventListener('pointerup',up)};xf.addEventListener('pointermove',mv);xf.addEventListener('pointerup',up)});xf.addEventListener('dblclick',function(){window._setFluxCross(0)});xf.addEventListener('wheel',function(e){e.preventDefault();window._setFluxCross(crossVal+(e.deltaY<0?6:-6))},{passive:false});applyCross2();}
function setupMixerShort(){
  try{
    if(typeof decks==='undefined')return;
    decks.forEach(function(d){
      var chan=document.getElementById('chan'+d.id); if(!chan||chan.dataset.vf) return; chan.dataset.vf='1';
      var gainWrap=chan.querySelector('[data-k="vol"]');
      var f=document.createElement('div'); f.className='chFader';
      f.innerHTML='<div class="ctl">FADER</div><div class="vfader" title="Channel fader"><div class="vfCap"></div></div><div class="vfVal">82</div>';
      var xa=null; chan.querySelectorAll('.ctl').forEach(function(c){if(c.textContent.indexOf('X-ASSIGN')>-1)xa=c});
      if(xa) chan.insertBefore(f,xa); else chan.appendChild(f);
      var track=f.querySelector('.vfader'), cap=f.querySelector('.vfCap'), val=f.querySelector('.vfVal');
      function render(v){cap.style.top=(100-v)+'%'; val.textContent=Math.round(v); if(gainWrap){var ind=gainWrap.querySelector('.knobInd'); if(ind) ind.style.transform='rotate('+(-135+(v/100)*270)+'deg)'; var kv=gainWrap.querySelector('.knobVal'); if(kv) kv.textContent=Math.round(v);}}
      function setV(v01){var v=Math.max(0,Math.min(100,v01)); d.vol=v/100; render(v); if(d.chGain) d.chGain.gain.value=d.vol*d.vol; try{if(window.st) st('CH '+d.id+' fader '+Math.round(v));}catch(e){}}
      render((typeof d.vol==='number'?d.vol*100:82));
      function fromEv(e){var r=track.getBoundingClientRect(); var p=1-((e.clientY-r.top)/r.height); setV(p*100);}
      track.addEventListener('pointerdown',function(e){e.preventDefault();try{track.setPointerCapture(e.pointerId)}catch(_){}fromEv(e);var mv=function(ev){fromEv(ev)};var up=function(){track.removeEventListener('pointermove',mv);track.removeEventListener('pointerup',up);track.removeEventListener('pointercancel',up)};track.addEventListener('pointermove',mv);track.addEventListener('pointerup',up);track.addEventListener('pointercancel',up);});
      track.addEventListener('dblclick',function(){setV(82)});
      track.addEventListener('wheel',function(e){e.preventDefault(); setV((d.vol*100)+(e.deltaY<0?5:-5))},{passive:false});
      if(gainWrap){var gk=gainWrap.querySelector('.knob'); if(gk){gk.addEventListener('pointerup',function(){setTimeout(function(){var kv=gainWrap.querySelector('.knobVal');var nv=kv?parseFloat(kv.textContent):NaN;if(!isNaN(nv))render(nv);},30);});}}
      d._vfRender=render;
    });
  }catch(e){console.warn('mixer',e)}
}
function setupPadsFixed(){
  try{
    decks.forEach(function(d){
      var el=d.el||$('#deck'+d.id); if(!el||el.dataset.padsfixed) return;
      var cuesEl=$('#cues'+d.id,el), rollsEl=$('#rolls'+d.id,el), stemsEl=el.querySelector('.stems');
      if(!cuesEl) return; el.dataset.padsfixed='1';
      var sects=[cuesEl.closest('.sect'), rollsEl?rollsEl.closest('.sect'):null, stemsEl?stemsEl.closest('.sect'):null].filter(Boolean);
      var box=document.createElement('div'); box.className='sect padBox'; box.dataset.deck=d.id;
      box.innerHTML='<div class="padMode"><button type="button" data-pm="hot" class="on">HOT CUE</button><button type="button" data-pm="roll">ROLL</button><button type="button" data-pm="stems">STEMS</button><button type="button" data-pm="samp">SAMPLER</button></div>';
      var hot=document.createElement('div'); hot.className='pane pads8 on'; hot.dataset.pane='hot'; hot.id='hot'+d.id;
      for(var c=0;c<8;c++){(function(i){var b=document.createElement('button'); b.type='button'; b.className='pad hotpad'; b.textContent='HOT '+(i+1);
        if(d.cues && d.cues[i]!=null){b.classList.add('set');}
        b.addEventListener('click',function(e){ e.stopPropagation(); try{ cue(d,i,b,e); if(d.cues[i]!=null) b.classList.add('set'); }catch(err){console.warn(err)} });
        hot.appendChild(b);
      })(c);}
      var roll=document.createElement('div'); roll.className='pane rolls2'; roll.dataset.pane='roll'; roll.id='rollpane'+d.id;
      [0.25,0.5,1,2,4].forEach(function(x){var b=document.createElement('button'); b.type='button'; b.className='pad rollpad'; b.textContent='ROLL '+x;
        b.addEventListener('pointerdown',function(e){e.preventDefault(); e.stopPropagation(); try{startRoll(d,x,b);}catch(err){console.warn(err)}});
        ['pointerup','pointerleave','pointercancel'].forEach(function(ev){b.addEventListener(ev,function(e){e.stopPropagation(); try{stopRoll(d);}catch(err){}})});
        roll.appendChild(b);});
      var stp=document.createElement('div'); stp.className='pane stemsPane'; stp.dataset.pane='stems'; stp.id='stems'+d.id;
      [['drums','DRUMS'],['vocal','VOCAL'],['inst','INST']].forEach(function(pair){var k=pair[0];var b=document.createElement('button'); b.type='button'; b.className='pad stemPad'; if(d.stems && d.stems[k]) b.classList.add('on'); b.textContent=pair[1];
        b.addEventListener('click',function(e){e.stopPropagation(); d.stems[k]=!d.stems[k]; b.classList.toggle('on',d.stems[k]); try{applyStems(d);}catch(err){} try{window.st&&window.st('Deck '+d.id+' '+pair[1]+(d.stems[k]?' ON':' OFF'));}catch(err){} });
        stp.appendChild(b);});
      var samp=document.createElement('div'); samp.className='pane sampGrid'; samp.dataset.pane='samp'; samp.id='samp'+d.id;
      for(var s=0;s<8;s++){(function(i){var b=document.createElement('button'); b.type='button'; b.className='pad sampPad'; b.textContent='SMP '+(i+1);
        b.addEventListener('click',function(e){e.stopPropagation(); try{ if(typeof ready!=='undefined'&&!ready)init(); if(!d.audio.src){window.st&&window.st('Sampler D'+d.id+': load a track first'); return;} var dur=d.audio.duration||8; var t=Math.min(i*2, Math.max(0,dur-1)); d.audio.currentTime=t; if(d.audio.paused)d.audio.play(); b.classList.add('set'); setTimeout(function(){b.classList.remove('set')},220); window.st&&window.st('Sampler D'+d.id+' '+(i+1)); }catch(err){console.warn(err)} });
        samp.appendChild(b);})(s);}
      box.appendChild(hot); box.appendChild(roll); box.appendChild(stp); box.appendChild(samp);
      box.querySelectorAll('[data-pm]').forEach(function(btn){btn.addEventListener('click',function(e){e.stopPropagation(); box.querySelectorAll('[data-pm]').forEach(function(x){x.classList.toggle('on',x===btn)}); box.querySelectorAll('[data-pane]').forEach(function(p){p.classList.toggle('on',p.dataset.pane===btn.dataset.pm)}); });});
      sects.forEach(function(s){s.remove();});
      el.appendChild(box);
    });
  }catch(e){console.warn('pads',e)}
}
function setupSettings(){if($('#settingsBtn'))return;var hr=$('.hrow');if(hr){var b=document.createElement('button');b.id='settingsBtn';b.textContent='\u2699 SETTINGS';var en=$('#enable');hr.insertBefore(b,en||null)}document.body.insertAdjacentHTML('beforeend','<div class="setPanel" id="setPanel"><div class="setBox"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">Settings</h3><button id="setClose">\u2715 CLOSE</button></div><div class="setRow"><label>Quantize</label><input id="setQuant" type="checkbox"></div><div class="setRow"><label>Deck mode</label><select id="setDeckMode"><option value="2">2 Deck</option><option value="4">4 Deck</option></select></div><div class="setRow"><label>Sync master</label><select id="setMaster"><option>1</option><option>2</option><option>3</option><option>4</option></select></div><div class="setRow"><label>Crossfader curve</label><select id="xfCurve"><option value="smooth">Smooth</option><option value="cut">Cut</option><option value="sharp">Sharp</option></select></div><div class="setRow"><label>Crossfader</label><span><button id="xfLeft">LEFT</button> <button id="xfCenterBtn">CENTER</button> <button id="xfRight">RIGHT</button></span></div><div class="setRow"><label>Tempo range</label><select id="setTempoRange"><option value="8">+/-8%</option><option value="16">+/-16%</option><option value="50">+/-50%</option></select></div><div class="setRow"><label>Vinyl (all decks)</label><input id="setVinyl" type="checkbox" checked></div><div class="setRow"><label>Reset crossfader</label><button id="setReset">RESET</button></div><p class="hint">Saved to this browser.</p></div></div>');var open=function(){var q=$('#quantize');if($('#setQuant'))$('#setQuant').checked=q?q.checked:true;try{if($('#setDeckMode'))$('#setDeckMode').value=String(deckMode)}catch(e){}try{if($('#setMaster'))$('#setMaster').value=String(masterDeck)}catch(e){}if($('#xfCurve'))$('#xfCurve').value=curve;$('#setPanel').classList.add('on')};$('#settingsBtn').onclick=open;$('#setClose').onclick=function(){$('#setPanel').classList.remove('on');save()};$('#setPanel').addEventListener('click',function(e){if(e.target.id==='setPanel'){$('#setPanel').classList.remove('on');save()}});$('#setQuant').onchange=function(e){if($('#quantize'))$('#quantize').checked=e.target.checked;save()};$('#setDeckMode').onchange=function(e){try{setDeckMode(+e.target.value)}catch(_){var dm=$('#deckMode');if(dm){dm.value=e.target.value;dm.dispatchEvent(new Event('change'))}}save()};$('#setMaster').onchange=function(e){try{setMaster(+e.target.value)}catch(_){var ms=$('#masterSel');if(ms){ms.value=e.target.value;ms.dispatchEvent(new Event('change'))}}save()};$('#xfCurve').onchange=function(e){curve=e.target.value;applyCross2();save();try{st('Crossfader curve: '+curve)}catch(_){}};$('#setTempoRange').onchange=function(e){try{decks.forEach(function(d){var s=d.el.querySelector('[data-in="tempo"]'),sel=d.el.querySelector('[data-in="range"]');if(sel)sel.value=e.target.value;if(s){s.min=-e.target.value;s.max=e.target.value}})}catch(_){}save()};$('#setVinyl').onchange=function(e){try{decks.forEach(function(d){d.vinyl=e.target.checked;var vb=d.el.querySelector('[data-a="vinyl"]');if(vb)vb.classList.toggle('on',d.vinyl)})}catch(_){}save()};$('#xfLeft').onclick=function(){window._setFluxCross(-100)};$('#xfCenterBtn').onclick=function(){window._setFluxCross(0)};$('#xfRight').onclick=function(){window._setFluxCross(100)};$('#setReset').onclick=function(){curve='smooth';if($('#xfCurve'))$('#xfCurve').value='smooth';window._setFluxCross(0)};}
setupCross();
setupMixerShort();
setupPadsFixed();
setupSettings();
applyCross2();
})();
