/**
 * FLUX Database Connection Layer (flux-db.js)
 * Browser equivalent of the Rekordbox Database Connection Layer (Python/pyrekordbox).
 *
 * Mirrors RekordboxDatabase:
 *  connect / isConnected / disconnect, 30s active-content cache, backup-before-mutation
 *  (5-min cooldown), search / playlists / history / import / cleanup, _content_to_track.
 * Storage: IndexedDB ("flux-dj-db") with in-memory + localStorage fallback.
 * Rekordbox import: Rekordbox XML export (COLLECTION + PLAYLISTS) and FLUX library sync.
 */
(function (root) {
  "use strict";
  var SUPPORTED = [".mp3", ".m4a", ".flac", ".wav", ".aiff", ".aif", ".ogg", ".opus"];
  function nowISO(){ return new Date().toISOString(); }
  function uid(p){ return (p||"id")+"_"+Date.now().toString(36)+Math.random().toString(36).slice(2,9); }
  function ext(name){ var m=/(\.[a-z0-9]+)$/i.exec(name||""); return m?m[1].toLowerCase():""; }
  function clone(x){ return JSON.parse(JSON.stringify(x)); }

  function FluxDatabase(){
    this.db=null; this.databaseName="flux-dj-db"; this.databasePath="indexeddb://flux-dj-db";
    this._connected=false;
    this._content=[]; this._playlists=[]; this._playlistSongs=[]; this._histories=[]; this._historySongs=[]; this._backups=[];
    this._contentCache=null; this._contentCacheTime=0; this._contentCacheTTL=30.0; // seconds, as Rekordbox layer
    this._lastBackupTime=0; this._backupCooldown=300.0; // 5 minutes, as Rekordbox layer
    this._saveTimer=null;
  }

  // ---------- connection ----------
  FluxDatabase.prototype.connect = async function(databaseName){
    if(databaseName) this.databaseName=databaseName;
    var self=this;
    await this._loadSnapshot();
    this._connected=true;
    console.info("[FluxDB] Connected to "+this.databaseName+" - "+this._getActiveContent().length+" tracks");
    return this;
  };
  FluxDatabase.prototype.isConnected = async function(){ return this._connected; };
  FluxDatabase.prototype.disconnect = async function(){ await this._saveSnapshot(); this._connected=false; this._invalidateContentCache(); };
  FluxDatabase.prototype._require = function(){ if(!this._connected) throw new Error("Database not connected"); };

  FluxDatabase.prototype._loadSnapshot = function(){
    var self=this;
    function apply(s){ if(!s) return; self._content=s.content||[]; self._playlists=s.playlists||[]; self._playlistSongs=s.playlistSongs||[]; self._histories=s.histories||[]; self._historySongs=s.historySongs||[]; self._backups=s.backups||[]; }
    if(root.indexedDB){
      return new Promise(function(resolve){
        var req=root.indexedDB.open(self.databaseName,1);
        req.onupgradeneeded=function(){ var db=req.result; if(!db.objectStoreNames.contains("meta")) db.createObjectStore("meta"); };
        req.onerror=function(){ try{apply(JSON.parse(root.localStorage.getItem("flux-db-v1")||"null"));}catch(e){} resolve(); };
        req.onsuccess=function(){ self.db=req.result; try{
          var tx=self.db.transaction("meta","readonly").objectStore("meta").get("snapshot");
          tx.onsuccess=function(){ apply(tx.result); resolve(); }; tx.onerror=function(){ resolve(); };
        }catch(e){ resolve(); } };
      });
    }
    try{ apply(JSON.parse(root.localStorage.getItem("flux-db-v1")||"null")); }catch(e){}
    return Promise.resolve();
  };
  FluxDatabase.prototype._saveSnapshot = function(){
    var self=this, snap=this._snapshot();
    try{ root.localStorage.setItem("flux-db-v1", JSON.stringify(snap)); }catch(e){}
    if(this.db){ try{ this.db.transaction("meta","readwrite").objectStore("meta").put(snap,"snapshot"); }catch(e){} }
    return Promise.resolve();
  };
  FluxDatabase.prototype._scheduleSave = function(){ var self=this; clearTimeout(this._saveTimer); this._saveTimer=setTimeout(function(){ self._saveSnapshot(); },120); };
  FluxDatabase.prototype._snapshot = function(){ return {content:this._content,playlists:this._playlists,playlistSongs:this._playlistSongs,histories:this._histories,historySongs:this._historySongs,backups:this._backups,savedAt:nowISO()}; };

  // ---------- cache / backup (same policy as Rekordbox layer) ----------
  FluxDatabase.prototype._getActiveContent = function(){
    var now=Date.now()/1000;
    if(this._contentCache && (now-this._contentCacheTime)<this._contentCacheTTL) return this._contentCache;
    this._contentCache=this._content.filter(function(c){ return !c.deleted; });
    this._contentCacheTime=now; return this._contentCache;
  };
  FluxDatabase.prototype._invalidateContentCache = function(){ this._contentCache=null; this._contentCacheTime=0; };
  FluxDatabase.prototype._createBackup = function(){
    var now=Date.now()/1000;
    if(this._lastBackupTime && (now-this._lastBackupTime)<this._backupCooldown) return null;
    this._lastBackupTime=now;
    var b={id:uid("backup"), createdAt:nowISO(), snapshot:clone(this._snapshot())};
    delete b.snapshot.backups; this._backups.push(b); this._backups=this._backups.slice(-5); this._scheduleSave();
    console.info("[FluxDB] Backup created: "+b.id); return b;
  };
  FluxDatabase.prototype.listBackups = async function(){ return this._backups.map(function(b){return {id:b.id,createdAt:b.createdAt};}); };
  FluxDatabase.prototype.restoreBackup = async function(id){ var b=this._backups.find(function(x){return x.id===id;}); if(!b) return false; var s=clone(b.snapshot); this._content=s.content||[]; this._playlists=s.playlists||[]; this._playlistSongs=s.playlistSongs||[]; this._histories=s.histories||[]; this._historySongs=s.historySongs||[]; this._invalidateContentCache(); await this._saveSnapshot(); return true; };

  // ---------- field mapping (_content_to_track) ----------
  FluxDatabase.prototype._contentToTrack = function(c){
    return { id:String(c.id), title:c.title||"", artist:c.artist||"", album:c.album||"", genre:c.genre||"", bpm:+c.bpm||0, key:c.key||"", rating:+c.rating||0,
      playCount:+c.playCount||0, length:+c.length||0, filePath:c.filePath||"", fileName:c.fileName||"", dateAdded:c.dateAdded||"", dateModified:c.dateModified||"",
      bitrate:+c.bitrate||0, sampleRate:+c.sampleRate||0, comments:c.comments||"", cues:c.cues||[], deleted:!!c.deleted };
  };
  FluxDatabase.prototype._track = function(c){ return this._contentToTrack(c); };

  // ---------- read operations ----------
  FluxDatabase.prototype.getTrackCount = async function(){ this._require(); return this._getActiveContent().length; };
  FluxDatabase.prototype.searchTracks = async function(options){
    this._require(); options=options||{}; var limit=options.limit||100, q=(options.query||"").toLowerCase();
    return this._getActiveContent().filter(function(c){
      var bpm=+c.bpm||0, rating=+c.rating||0;
      if(q && !(String(c.title||"").toLowerCase().includes(q)||String(c.artist||"").toLowerCase().includes(q)||String(c.genre||"").toLowerCase().includes(q))) return false;
      if(options.artist && !String(c.artist||"").toLowerCase().includes(options.artist.toLowerCase())) return false;
      if(options.title && !String(c.title||"").toLowerCase().includes(options.title.toLowerCase())) return false;
      if(options.genre && !String(c.genre||"").toLowerCase().includes(options.genre.toLowerCase())) return false;
      if(options.key && options.key!==c.key) return false;
      if(options.bpm_min && bpm<options.bpm_min) return false;
      if(options.bpm_max && bpm>options.bpm_max) return false;
      if(options.rating_min && rating<options.rating_min) return false;
      return true;
    }).slice(0,limit).map(this._track.bind(this));
  };
  FluxDatabase.prototype.getTrackById = async function(id){ this._require(); var c=this._getActiveContent().find(function(x){return String(x.id)===String(id);}); return c?this._track(c):null; };
  FluxDatabase.prototype.getMostPlayedTracks = async function(limit){ limit=limit||20; return this._getActiveContent().slice().sort(function(a,b){return (b.playCount||0)-(a.playCount||0);}).slice(0,limit).map(this._track.bind(this)); };
  FluxDatabase.prototype.getTopRatedTracks = async function(limit){ limit=limit||20; return this._getActiveContent().slice().sort(function(a,b){return ((b.rating||0)-(a.rating||0))||((b.playCount||0)-(a.playCount||0));}).slice(0,limit).map(this._track.bind(this)); };
  FluxDatabase.prototype.getUnplayedTracks = async function(limit){ limit=limit||50; return this._getActiveContent().filter(function(c){return !(c.playCount||0);}).slice(0,limit).map(this._track.bind(this)); };
  FluxDatabase.prototype.searchTracksByFilename = async function(name){ var q=String(name||"").toLowerCase(); return this._getActiveContent().filter(function(c){return String(c.filePath||c.fileName||"").toLowerCase().includes(q);}).map(this._track.bind(this)); };
  FluxDatabase.prototype.getTracksByGenre = async function(genre){ var q=String(genre||"").toLowerCase(); return this._getActiveContent().filter(function(c){return String(c.genre||"").toLowerCase().includes(q) && c.filePath;}).map(function(c){return c.filePath;}); };
  FluxDatabase.prototype.validateTrackIds = async function(ids){ var set={}; this._getActiveContent().forEach(function(c){set[String(c.id)]=1;}); var valid=[],invalid=[]; (ids||[]).forEach(function(id){ (set[String(id)]?valid:invalid).push(id); }); return {valid:valid,invalid:invalid,total_checked:ids.length,valid_count:valid.length,invalid_count:invalid.length}; };
  FluxDatabase.prototype.analyzeLibrary = async function(groupBy, aggregateBy, topN){
    this._require(); var field={genre:"genre",key:"key",year:"year",artist:"artist",rating:"rating"}[groupBy]||"genre", groups={};
    this._getActiveContent().forEach(function(c){ var k=String(c[field]||"Unknown"); if(!groups[k]) groups[k]={count:0,playCount:0,totalTime:0}; groups[k].count++; groups[k].playCount+=+c.playCount||0; groups[k].totalTime+=+c.length||0; });
    var sorted=Object.entries(groups).sort(function(a,b){return b[1][aggregateBy||"count"]-a[1][aggregateBy||"count"];}).slice(0,topN||10);
    var results={}; sorted.forEach(function(e){results[e[0]]=e[1];});
    return {group_by:groupBy, aggregate_by:aggregateBy||"count", results:results, total_groups:Object.keys(groups).length};
  };
  FluxDatabase.prototype.getLibraryStats = async function(){
    this._require(); var a=this._getActiveContent(), genres={};
    a.forEach(function(c){ var g=c.genre||"Unknown"; genres[g]=(genres[g]||0)+1; });
    return { total_tracks:a.length, total_playtime_seconds:a.reduce(function(s,c){return s+(+c.length||0);},0),
      average_bpm:a.length?Math.round(a.reduce(function(s,c){return s+(+c.bpm||0);},0)/a.length*100)/100:0,
      genre_distribution:Object.fromEntries(Object.entries(genres).sort(function(x,y){return y[1]-x[1];}).slice(0,10)),
      database_path:this.databasePath, last_updated:nowISO() };
  };

  // ---------- playlists ----------
  FluxDatabase.prototype.getPlaylists = async function(){
    this._require(); var self=this;
    return this._playlists.filter(function(p){return !p.deleted;}).map(function(p){
      var count=self._playlistSongs.filter(function(s){return String(s.playlistId)===String(p.id)&&!s.deleted;}).length;
      return {id:String(p.id),name:p.name||"",track_count:count,created_date:p.createdAt||"",modified_date:p.updatedAt||"",is_folder:!!p.isFolder,is_smart_playlist:!!p.isSmart,smart_criteria:p.smartCriteria||null,parent_id:p.parentId||null};
    });
  };
  FluxDatabase.prototype.getPlaylistTracks = async function(playlistId){
    this._require(); var lookup={}; this._getActiveContent().forEach(function(c){lookup[String(c.id)]=c;},this);
    return this._playlistSongs.filter(function(s){return String(s.playlistId)===String(playlistId)&&!s.deleted;})
      .sort(function(a,b){return (a.trackNo||0)-(b.trackNo||0);})
      .map(function(s){return lookup[String(s.contentId)];}).filter(Boolean).map(this._track.bind(this));
  };
  FluxDatabase.prototype.createPlaylist = async function(name,parentId,isFolder){
    this._require(); this._createBackup();
    var p={id:uid("pl"),name:name,parentId:(parentId&&parentId!=="root")?String(parentId):null,isFolder:!!isFolder,isSmart:false,createdAt:nowISO(),updatedAt:nowISO(),deleted:false};
    this._playlists.push(p); this._scheduleSave(); return String(p.id);
  };
  FluxDatabase.prototype.addTrackToPlaylist = async function(playlistId,trackId){
    this._require(); this._createBackup();
    if(this._playlistSongs.some(function(s){return String(s.playlistId)===String(playlistId)&&String(s.contentId)===String(trackId)&&!s.deleted;})) return true;
    var n=this._playlistSongs.filter(function(s){return String(s.playlistId)===String(playlistId);}).length+1;
    this._playlistSongs.push({id:uid("pls"),playlistId:String(playlistId),contentId:String(trackId),trackNo:n,deleted:false}); this._scheduleSave(); return true;
  };
  FluxDatabase.prototype.addTracksToPlaylist = async function(playlistId,trackIds){
    var res={added:[],failed:[],skipped:[]};
    for(var i=0;i<(trackIds||[]).length;i++){ try{ await this.addTrackToPlaylist(playlistId,trackIds[i]); res.added.push(trackIds[i]); }catch(e){ res.failed.push({track_id:trackIds[i],reason:String(e.message||e)}); } }
    return res;
  };
  FluxDatabase.prototype.removeTrackFromPlaylist = async function(playlistId,trackIdOrSong){
    this._require(); this._createBackup();
    this._playlistSongs.forEach(function(s){ if(String(s.playlistId)===String(playlistId)&&(String(s.contentId)===String(trackIdOrSong)||String(s.id)===String(trackIdOrSong))) s.deleted=true; });
    this._scheduleSave(); return true;
  };
  FluxDatabase.prototype.deletePlaylist = async function(playlistId){ this._require(); this._createBackup(); this._playlists.forEach(function(p){if(String(p.id)===String(playlistId))p.deleted=true;}); this._playlistSongs.forEach(function(s){if(String(s.playlistId)===String(playlistId))s.deleted=true;}); this._scheduleSave(); return true; };

  // ---------- history ----------
  FluxDatabase.prototype.startHistorySession = async function(name){
    this._require(); var h={id:uid("hist"),name:name||("SESSION "+new Date().toLocaleDateString()),parentId:null,isFolder:false,dateCreated:nowISO(),deleted:false};
    this._histories.push(h); this._scheduleSave(); return String(h.id);
  };
  FluxDatabase.prototype.recordPlay = async function(trackId,sessionId){
    this._require(); var c=this._content.find(function(x){return String(x.id)===String(trackId);}); if(c){ c.playCount=(+c.playCount||0)+1; }
    var sid=sessionId|| (this._histories.length?String(this._histories[this._histories.length-1].id):await this.startHistorySession());
    var n=this._historySongs.filter(function(s){return String(s.historyId)===String(sid);}).length+1;
    this._historySongs.push({id:uid("hs"),historyId:String(sid),contentId:String(trackId),trackNo:n,deleted:false}); this._invalidateContentCache(); this._scheduleSave(); return sid;
  };
  FluxDatabase.prototype.getHistorySessions = async function(includeFolders){
    this._require(); var lookup={}; this._getActiveContent().forEach(function(c){lookup[String(c.id)]=c;});
    return this._histories.filter(function(h){return !h.deleted && (includeFolders||!h.isFolder);}).map(function(h){
      var songs=this._historySongs.filter(function(s){return String(s.historyId)===String(h.id)&&!s.deleted;});
      var secs=songs.reduce(function(sum,s){ var c=lookup[String(s.contentId)]; return sum+(c?+c.length||0:0); },0);
      return {id:String(h.id),name:h.name||"",parent_id:h.parentId||null,is_folder:!!h.isFolder,date_created:h.dateCreated,track_count:songs.length,duration_minutes:secs?Math.round(secs/60):null};
    },this);
  };
  FluxDatabase.prototype.getSessionTracks = async function(sessionId){
    var lookup={}; this._getActiveContent().forEach(function(c){lookup[String(c.id)]=c;});
    return this._historySongs.filter(function(s){return String(s.historyId)===String(sessionId)&&!s.deleted;}).sort(function(a,b){return a.trackNo-b.trackNo;})
      .map(function(s){ var c=lookup[String(s.contentId)]; if(!c) return null; var t=this._track(c); t.track_number=s.trackNo; t.history_id=String(sessionId); t.play_order=s.trackNo; return t; },this).filter(Boolean);
  };
  FluxDatabase.prototype.getHistoryStats = async function(){
    var sessions=await this.getHistorySessions(false), totalTracks=sessions.reduce(function(s,x){return s+x.track_count;},0), totalMin=sessions.reduce(function(s,x){return s+(x.duration_minutes||0);},0), byMonth={};
    sessions.forEach(function(s){ if(s.date_created){ var k=s.date_created.slice(0,7); byMonth[k]=(byMonth[k]||0)+1; }});
    return {total_sessions:sessions.length,total_tracks_played:totalTracks,total_hours_played:Math.round(totalMin/6)/10,sessions_by_month:byMonth,avg_session_length:sessions.length?Math.round(totalMin/sessions.length*10)/10:0,favorite_genres:[],most_played_track:null};
  };

  // ---------- import ----------
  FluxDatabase.prototype._readAudioTags = async function(file){
    var tags={};
    if(typeof root.FluxTagReader==="function"){ try{ Object.assign(tags, await root.FluxTagReader(file)); }catch(e){} }
    var name=(file&&(file.name||file.fileName))||String(file||"");
    if(!tags.title){ var base=name.replace(/\.[^.]+$/,""); var parts=base.split(" - "); if(parts.length>1){ tags.artist=tags.artist||parts[0].trim(); tags.title=parts.slice(1).join(" - ").trim(); } else tags.title=base; }
    // Duration in browser via <audio> when a File/Blob is supplied
    if(file && root.document && root.URL && typeof file==="object" && file.size!==undefined){
      try{ tags.length=await new Promise(function(res){ var a=document.createElement("audio"); a.preload="metadata"; a.onloadedmetadata=function(){ var d=Math.round(a.duration||0); URL.revokeObjectURL(a.src); res(d||undefined); }; a.onerror=function(){res(undefined);}; a.src=URL.createObjectURL(file); }); }catch(e){}
    }
    return tags;
  };
  FluxDatabase.prototype.importTrack = async function(fileOrPath, metadata, opts){
    this._require(); opts=opts||{}; var autoTag=opts.autoTag!==false;
    var isFile=fileOrPath && typeof fileOrPath==="object";
    var name=isFile?(fileOrPath.name||"") : String(fileOrPath||"").split(/[\\/]/).pop();
    var filePath=isFile?name:String(fileOrPath||"");
    if(!isFile && !filePath) return {status:"error",path:filePath,reason:"file not found"};
    if(SUPPORTED.indexOf(ext(name))===-1 && name) return {status:"error",path:filePath,reason:"unsupported extension "+ext(name)};
    if(this._content.some(function(c){return !c.deleted && c.filePath===filePath && filePath;})) return {status:"skipped",path:filePath,reason:"already in library"};
    var merged={};
    if(autoTag && isFile) merged=await this._readAudioTags(fileOrPath);
    if(metadata) Object.keys(metadata).forEach(function(k){ if(metadata[k]!=null) merged[k]=metadata[k]; });
    this._createBackup();
    var c={id:uid("trk"), title:merged.title||name.replace(/\.[^.]+$/,""), artist:merged.artist||"", album:merged.album||"", genre:merged.genre||"", label:merged.label||"",
      bpm:merged.bpm?Math.round(+merged.bpm*100)/100:0, key:merged.key||"", rating:merged.rating||0, playCount:0, length:merged.length||0,
      filePath:filePath, fileName:name, fileBlob:isFile?fileOrPath:null, dateAdded:nowISO(), dateModified:nowISO(), bitrate:merged.bitrate||0, sampleRate:merged.sampleRate||0,
      comments:merged.comments||"", year:merged.year||"", cues:merged.cues||[], deleted:false};
    this._content.push(c); this._invalidateContentCache(); this._scheduleSave();
    return {status:"success",track_id:String(c.id),path:filePath,metadata:merged,track:this._track(c)};
  };
  FluxDatabase.prototype.importTracks = async function(items, opts){
    opts=opts||{}; var imported=[],skipped=[],failed=[], list=[];
    (items||[]).forEach(function(it){ if(it && it.length!==undefined && typeof it!=="string" && it[0]!==undefined && it.name===undefined && typeof it!=="object") return; list.push(it); });
    // FileList / array of Files or paths
    var arr=Array.prototype.slice.call(items||[]);
    for(var i=0;i<arr.length;i++){ var r=await this.importTrack(arr[i],null,opts); if(r.status==="success") imported.push({track_id:r.track_id,path:r.path}); else if(r.status==="skipped") skipped.push({path:r.path,reason:r.reason}); else failed.push({path:r.path||String(arr[i]),reason:r.reason||"unknown"}); }
    return {summary:{scanned:arr.length,imported:imported.length,skipped:skipped.length,failed:failed.length},imported:imported,skipped:skipped,failed:failed};
  };
  // Rekordbox XML export file -> tracks + playlists (standard Rekordbox export format)
  FluxDatabase.prototype.importRekordboxXML = async function(text){
    if(!root.DOMParser) throw new Error("DOMParser unavailable");
    var doc=new DOMParser().parseFromString(text,"text/xml"), tracks=doc.querySelectorAll("COLLECTION > TRACK"), imported=0, map={};
    for(var i=0;i<tracks.length;i++){ var t=tracks[i], loc=(t.getAttribute("Location")||"").replace(/^file:\/\/localhost\//,""); try{ loc=decodeURIComponent(loc);}catch(e){}
      var r=await this.importTrack(loc,{title:t.getAttribute("Name"),artist:t.getAttribute("Artist"),album:t.getAttribute("Album"),genre:t.getAttribute("Genre"),bpm:parseFloat(t.getAttribute("AverageBpm")||0),key:t.getAttribute("Tonality"),length:parseInt(t.getAttribute("TotalTime")||0),bitrate:parseInt(t.getAttribute("BitRate")||0),sampleRate:parseInt(t.getAttribute("SampleRate")||0),comments:t.getAttribute("Comments"),year:t.getAttribute("Year")},{autoTag:false});
      if(r.track_id){ map[t.getAttribute("TrackID")]=r.track_id; imported++; } }
    var nodes=doc.querySelectorAll("PLAYLISTS NODE[Type='1']");
    for(var j=0;j<nodes.length;j++){ var pid=await this.createPlaylist(nodes[j].getAttribute("Name")); var entries=nodes[j].querySelectorAll("TRACK");
      for(var k=0;k<entries.length;k++){ var nid=map[entries[k].getAttribute("Key")]; if(nid) await this.addTrackToPlaylist(pid,nid); } }
    return {imported:imported, playlists:nodes.length};
  };
  FluxDatabase.prototype.exportJSON = async function(){ return JSON.stringify(this._snapshot(),null,2); };
  FluxDatabase.prototype.exportRekordboxXML = async function(){
    function esc(s){ return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;"); }
    var out=['<?xml version="1.0" encoding="UTF-8"?>','<DJ_PLAYLISTS Version="1.0.0"><PRODUCT Name="FLUX DJ" Version="1.0" Company="FLUX"/><COLLECTION>'];
    this._getActiveContent().forEach(function(c){ out.push('<TRACK TrackID="'+c.id+'" Name="'+esc(c.title)+'" Artist="'+esc(c.artist)+'" Album="'+esc(c.album)+'" Genre="'+esc(c.genre)+'" TotalTime="'+(c.length||0)+'" AverageBpm="'+(c.bpm||0)+'" Tonality="'+esc(c.key)+'" BitRate="'+(c.bitrate||0)+'" SampleRate="'+(c.sampleRate||0)+'" Location="file://localhost/'+encodeURIComponent(c.filePath||c.fileName||"")+'"/>'); });
    out.push("</COLLECTION><PLAYLISTS><NODE Type=\"0\" Name=\"ROOT\">");
    var pls=await this.getPlaylists();
    for(var i=0;i<pls.length;i++){ var tr=await this.getPlaylistTracks(pls[i].id); out.push('<NODE Type="1" Name="'+esc(pls[i].name)+'" Entries="'+tr.length+'">'+tr.map(function(t){return '<TRACK Key="'+t.id+'"/>';}).join("")+"</NODE>"); }
    out.push("</NODE></PLAYLISTS></DJ_PLAYLISTS>"); return out.join("\n");
  };
  // Sync with existing FLUX globals (lib[] built by index.html)
  FluxDatabase.prototype.syncFromFluxLib = async function(lib){
    var n=0; lib=lib||root.lib||[];
    for(var i=0;i<lib.length;i++){ var t=lib[i], f=t.file||t; var r=await this.importTrack(f,{title:(f&&f.name)||t.title,bpm:t.bpm||undefined,key:t.key,artist:t.artist,length:t.len&&parseInt(t.len)?undefined:undefined},{autoTag:false}); if(r.status==="success") n++; }
    return {synced:n,total:lib.length};
  };
  FluxDatabase.prototype.updateTrack = async function(id, patch){ this._require(); this._createBackup(); var c=this._content.find(function(x){return String(x.id)===String(id);}); if(!c) return null; Object.assign(c,patch||{}); c.dateModified=nowISO(); this._invalidateContentCache(); this._scheduleSave(); return this._track(c); };

  // ---------- cleanup ----------
  FluxDatabase.prototype.findBrokenTracks = async function(){
    this._require(); var empty=[],streams=[],missing=[],active=this._getActiveContent(), ids={}; active.forEach(function(c){ids[String(c.id)]=1;});
    active.forEach(function(c){ var fp=c.filePath||""; if(!fp.trim()) empty.push({id:String(c.id),title:c.title}); else if(fp.indexOf("apple-music:")===0) streams.push({id:String(c.id),title:c.title,path:fp}); else if(!c.fileBlob && !fp) missing.push({id:String(c.id),title:c.title,path:fp}); });
    var orphans=[]; this._playlistSongs.filter(function(s){return !s.deleted && !ids[String(s.contentId)];}).forEach(function(s){ orphans.push({playlist_id:String(s.playlistId),content_id:String(s.contentId),song_id:String(s.id)}); });
    return {empty_path:empty,apple_music_streams:streams,missing_files:missing,orphaned_playlist_refs:orphans,summary:{empty_path_count:empty.length,apple_music_count:streams.length,missing_file_count:missing.length,orphaned_ref_count:orphans.length}};
  };
  FluxDatabase.prototype.removeOrphanedPlaylistEntries = async function(){ this._require(); this._createBackup(); var ids={}; this._getActiveContent().forEach(function(c){ids[String(c.id)]=1;}); var removed=0; this._playlistSongs.forEach(function(s){ if(!s.deleted && !ids[String(s.contentId)]){ s.deleted=true; removed++; } }); this._scheduleSave(); return {removed_count:removed,details:[]}; };
  FluxDatabase.prototype.removeTracksByIds = async function(ids){
    this._require(); this._createBackup(); var removed=[],notFound=[];
    (ids||[]).forEach(function(id){ var c=this._content.find(function(x){return String(x.id)===String(id)&&!x.deleted;}); if(!c){notFound.push(id);return;} c.deleted=true; removed.push({id:String(id),title:c.title||""}); this._playlistSongs.forEach(function(s){if(String(s.contentId)===String(id))s.deleted=true;}); },this);
    this._invalidateContentCache(); this._scheduleSave(); return {removed:removed,not_found:notFound};
  };

  // Snake-case aliases matching the Python RekordboxDatabase API
  var aliases={connect:"connect",is_connected:"isConnected",get_track_count:"getTrackCount",search_tracks:"searchTracks",get_track_by_id:"getTrackById",get_playlists:"getPlaylists",get_playlist_tracks:"getPlaylistTracks",get_most_played_tracks:"getMostPlayedTracks",get_top_rated_tracks:"getTopRatedTracks",get_unplayed_tracks:"getUnplayedTracks",search_tracks_by_filename:"searchTracksByFilename",analyze_library:"analyzeLibrary",validate_track_ids:"validateTrackIds",get_library_stats:"getLibraryStats",get_tracks_by_genre:"getTracksByGenre",get_history_sessions:"getHistorySessions",get_session_tracks:"getSessionTracks",get_history_stats:"getHistoryStats",import_track:"importTrack",import_tracks:"importTracks",create_playlist:"createPlaylist",add_tracks_to_playlist:"addTracksToPlaylist",add_track_to_playlist:"addTrackToPlaylist",remove_track_from_playlist:"removeTrackFromPlaylist",delete_playlist:"deletePlaylist",find_broken_tracks:"findBrokenTracks",remove_orphaned_playlist_entries:"removeOrphanedPlaylistEntries",remove_tracks_by_ids:"removeTracksByIds"};
  Object.keys(aliases).forEach(function(snake){ FluxDatabase.prototype[snake]=FluxDatabase.prototype[aliases[snake]]; });

  root.FluxDatabase=FluxDatabase;
  root.FluxDB=root.FluxDB||new FluxDatabase();
  if(root.document){
    var boot=async function(){ try{ await root.FluxDB.connect(); if(Array.isArray(root.lib)&&root.lib.length) await root.FluxDB.syncFromFluxLib(root.lib); root.dispatchEvent(new CustomEvent("fluxdb:ready",{detail:{tracks:await root.FluxDB.getTrackCount()}})); }catch(e){ console.warn("[FluxDB]",e); } };
    if(root.document.readyState==="loading") root.document.addEventListener("DOMContentLoaded",boot); else boot();
  }
})(typeof window!=="undefined"?window:globalThis);
