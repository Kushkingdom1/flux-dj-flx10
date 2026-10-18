(function(){
function $(s,r){return (r||document).querySelector(s)}
function setupMixer(){
 try{
  if(typeof decks==='undefined')return;
  decks.forEach(function(d){
   var chan=document.getElementById('chan'+d.id); if(!chan||chan.dataset.vf) return; chan.dataset.vf='1';
   var gainWrap=chan.querySelector('[data-k="vol"]');
   var f=document.createElement('div'); f.className='chFader';
   f.innerHTML='<div class="ctl">FADER</div><div class="vfader" title="Drag channel fader"><div class="vfCap"></div></div><div class="vfVal">82</div>';
   var xa=null; chan.querySelectorAll('.ctl').forEach(function(c){if(c.textContent.indexOf('X-ASSIGN')>-1)xa=c});
   if(xa) chan.insertBefore(f,xa); else chan.appendChild(f);
   var track=f.querySelector('.vfader'), cap=f.querySelector('.vfCap'), val=f.querySelector('.vfVal');
   function render(v){cap.style.top=(100-v)+'%'; val.textContent=Math.round(v); if(gainWrap){var ind=gainWrap.querySelector('.knobInd'); if(ind) ind.style.transform='rotate('+(-135+(v/100)*270)+'deg)'; var kv=gainWrap.querySelector('.knobVal'); if(kv) kv.textContent=Math.round(v);}}
   function setV(v01){
     var v=Math.max(0,Math.min(100,v01));
     d.vol=v/100; render(v);
     if(d.chGain) d.chGain.gain.value=d.vol*d.vol;
     try{ if(window.st) st('CH '+d.id+' fader '+Math.round(v)); }catch(e){}
   }
   render((typeof d.vol==='number'?d.vol*100:82));
   function fromEv(e){var r=track.getBoundingClientRect(); var p=1-((e.clientY-r.top)/r.height); setV(p*100);}
   track.addEventListener('pointerdown',function(e){e.preventDefault(); try{track.setPointerCapture(e.pointerId)}catch(_){} fromEv(e); var mv=function(ev){fromEv(ev)}; var up=function(){track.removeEventListener('pointermove',mv); track.removeEventListener('pointerup',up); track.removeEventListener('pointercancel',up)}; track.addEventListener('pointermove',mv); track.addEventListener('pointerup',up); track.addEventListener('pointercancel',up);});
   track.addEventListener('dblclick',function(){setV(82)});
   track.addEventListener('wheel',function(e){e.preventDefault(); setV((d.vol*100)+(e.deltaY<0?5:-5))},{passive:false});
   if(gainWrap){var gk=gainWrap.querySelector('.knob'); if(gk){gk.addEventListener('pointerup',function(){ setTimeout(function(){var kv=gainWrap.querySelector('.knobVal'); var nv=kv?parseFloat(kv.textContent):NaN; if(!isNaN(nv)) render(nv); },30);});}}
  });
 }catch(e){console.warn('mixer',e)}
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(setupMixer,60)})}else{setTimeout(setupMixer,60)}
})();
