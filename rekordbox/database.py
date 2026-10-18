"""
Rekordbox Database Connection Layer

Handles connection to and interaction with the encrypted rekordbox SQLite database.
"""

import os
import sys
import time
import asyncio
import shutil
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime

from pyrekordbox import Rekordbox6Database
from loguru import logger

from .models import (
    Track,
    Playlist,
    SearchOptions,
    HistorySession,
    HistoryTrack,
    HistoryStats,
    LibraryStats,
)


class RekordboxDatabase:
    """
    Main interface for rekordbox database operations.

    Handles connection and querying operations on the encrypted
    rekordbox SQLite database using pyrekordbox.
    """

    def __init__(self):
        self.db: Optional[Rekordbox6Database] = None
        self.database_path: Optional[Path] = None
        self._connected = False
        # Content cache
        self._content_cache: Optional[list] = None
        self._content_cache_time: Optional[float] = None
        self._content_cache_ttl: float = 30.0  # seconds
        # Backup dedup
        self._last_backup_time: Optional[float] = None
        self._backup_cooldown: float = 300.0  # 5 minutes

    async def connect(self, database_path: Optional[Path] = None) -> None:
        """Connect to the rekordbox database."""

        def _connect():
            if database_path:
                self.database_path = database_path
                logger.info(f"Connecting to rekordbox database at: {database_path}")
            else:
                self.database_path = self._detect_database_path()
                logger.info(
                    f"Auto-detected rekordbox database at: {self.database_path}"
                )

            if self.database_path:
                self.db = Rekordbox6Database(db_dir=str(self.database_path))
            else:
                self.db = Rekordbox6Database()

            content = self.db.get_content()
            content_count = len(list(content))
            logger.info(
                f"Successfully connected! Found {content_count} tracks in database."
            )
            self._connected = True

        try:
            await asyncio.to_thread(_connect)
        except Exception as e:
            logger.error(f"Failed to connect to rekordbox database: {e}")
            raise RuntimeError(f"Database connection failed: {str(e)}")

    def _detect_database_path(self) -> Path:
        """Auto-detect the rekordbox database location based on OS."""
        if os.name == "nt":  # Windows
            base_path = Path.home() / "AppData" / "Roaming" / "Pioneer"
        elif sys.platform == "darwin":  # macOS
            base_path = Path.home() / "Library" / "Pioneer"
        else:  # Linux
            base_path = Path.home() / ".config" / "Pioneer"

        if not base_path.exists():
            raise FileNotFoundError(f"Rekordbox directory not found at {base_path}")

        return base_path

    async def is_connected(self) -> bool:
        """Check if database connection is active."""
        return self._connected and self.db is not None

    async def disconnect(self) -> None:
        """Properly close the database connection."""
        if self.db:
            try:
                await asyncio.to_thread(self.db.close)
                logger.info("Database connection closed")
            except Exception as e:
                logger.warning(f"Error closing database connection: {e}")
            finally:
                self.db = None
                self._connected = False
                self._invalidate_content_cache()

    def __del__(self):
        """Cleanup when object is destroyed."""
        if self.db:
            try:
                self.db.close()
            except Exception:
                pass

    # --- Cache management ---

    def _get_active_content(self) -> list:
        """Get active (non-deleted) content with caching."""
        now = time.monotonic()
        if (
            self._content_cache is not None
            and self._content_cache_time is not None
            and (now - self._content_cache_time) < self._content_cache_ttl
        ):
            return self._content_cache

        all_content = list(self.db.get_content())
        self._content_cache = [
            c for c in all_content if getattr(c, "rb_local_deleted", 0) == 0
        ]
        self._content_cache_time = now
        return self._content_cache

    def _invalidate_content_cache(self):
        """Clear content cache, forcing refresh on next access."""
        self._content_cache = None
        self._content_cache_time = None

    # --- Backup management ---

    def _create_backup(self) -> None:
        """Create a backup of the database before mutations. Deduplicates within cooldown."""
        if not self.database_path:
            return

        now = time.monotonic()
        if (
            self._last_backup_time is not None
            and (now - self._last_backup_time) < self._backup_cooldown
        ):
            logger.debug("Skipping backup — recent backup exists")
            return

        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

            possible_files = [
                self.database_path / "master.db",
                self.database_path / "rekordbox" / "master.db",
                *list(self.database_path.glob("**/master.db")),
                *list(self.database_path.glob("**/*.db")),
            ]

            db_file = None
            for file_path in possible_files:
                if file_path.exists() and file_path.is_file():
                    db_file = file_path
                    break

            if db_file:
                backup_path = self.database_path / f"master_backup_{timestamp}.db"
                shutil.copy2(db_file, backup_path)
                self._last_backup_time = now
                logger.info(f"Database backup created: {backup_path}")
            else:
                all_files = list(self.database_path.rglob("*"))
                db_files = [f for f in all_files if f.suffix == ".db"]
                logger.warning(
                    f"No database file found for backup. Available .db files: {db_files}"
                )

        except Exception as e:
            logger.warning(f"Failed to create database backup: {e}")

    def _content_to_track(self, content) -> Track:
        """Convert pyrekordbox content object to our Track model."""
        bpm_value = getattr(content, "BPM", 0) or 0
        bpm_float = float(bpm_value) / 100.0 if bpm_value else 0.0

        artist_name = ""
        if hasattr(content, "ArtistName"):
            artist_name = content.ArtistName or ""
        elif hasattr(content, "Artist"):
            artist_obj = content.Artist
            artist_name = (
                artist_obj.Name
                if hasattr(artist_obj, "Name")
                else str(artist_obj or "")
            )

        key_name = ""
        if hasattr(content, "KeyName"):
            key_name = content.KeyName or ""
        elif hasattr(content, "Key"):
            key_obj = content.Key
            key_name = key_obj.Name if hasattr(key_obj, "Name") else str(key_obj or "")

        album_name = ""
        if hasattr(content, "AlbumName"):
            album_name = content.AlbumName or ""
        elif hasattr(content, "Album"):
            album_obj = content.Album
            album_name = (
                album_obj.Name if hasattr(album_obj, "Name") else str(album_obj or "")
            )

        genre_name = ""
        if hasattr(content, "GenreName"):
            genre_name = content.GenreName or ""
        elif hasattr(content, "Genre"):
            genre_obj = content.Genre
            genre_name = (
                genre_obj.Name if hasattr(genre_obj, "Name") else str(genre_obj or "")
            )

        return Track(
            id=str(content.ID),
            title=content.Title or "",
            artist=artist_name,
            album=album_name,
            genre=genre_name,
            bpm=bpm_float,
            key=key_name,
            rating=int(getattr(content, "Rating", 0) or 0),
            play_count=int(getattr(content, "DJPlayCount", 0) or 0),
            length=int(getattr(content, "Length", 0) or 0),
            file_path=getattr(content, "FolderPath", "") or "",
            date_added=getattr(content, "DateCreated", "") or "",
            date_modified=getattr(content, "StockDate", "") or "",
            bitrate=int(getattr(content, "BitRate", 0) or 0),
            sample_rate=int(getattr(content, "SampleRate", 0) or 0),
            comments=getattr(content, "Commnt", "") or "",
        )

    async def search_tracks(self, options: "SearchOptions") -> List[Track]:
        """Search for tracks based on the provided options."""
        if not self.db:
            raise RuntimeError("Database not connected")

        def _inner():
            active_content = self._get_active_content()
            filtered_tracks = []

            for content in active_content:
                artist_name = getattr(content, "ArtistName", "") or ""
                genre_name = getattr(content, "GenreName", "") or ""
                key_name = getattr(content, "KeyName", "") or ""
                bpm_value = (getattr(content, "BPM", 0) or 0) / 100.0
                rating_value = getattr(content, "Rating", 0) or 0

                if options.query and not any(
                    [
                        options.query.lower() in str(content.Title or "").lower(),
                        options.query.lower() in artist_name.lower(),
                        options.query.lower() in genre_name.lower(),
                    ]
                ):
                    continue

                if options.artist and options.artist.lower() not in artist_name.lower():
                    continue
                if (
                    options.title
                    and options.title.lower() not in str(content.Title or "").lower()
                ):
                    continue
                if options.genre and options.genre.lower() not in genre_name.lower():
                    continue
                if options.key and options.key != key_name:
                    continue
                if options.bpm_min and bpm_value < options.bpm_min:
                    continue
                if options.bpm_max and bpm_value > options.bpm_max:
                    continue
                if options.rating_min and rating_value < options.rating_min:
                    continue

                filtered_tracks.append(self._content_to_track(content))

            return filtered_tracks[: options.limit]

        return await asyncio.to_thread(_inner)

    async def get_track_count(self) -> int:
        if not self.db:
            raise RuntimeError("Database not connected")
        return await asyncio.to_thread(lambda: len(self._get_active_content()))

    async def get_playlists(self) -> List[Playlist]:
        if not self.db:
            raise RuntimeError("Database not connected")

        def _inner():
            result = []
            for playlist in self.db.get_playlist():
                if getattr(playlist, "rb_local_deleted", 0) != 0:
                    continue
                try:
                    track_count = len(
                        [
                            s
                            for s in self.db.get_playlist_songs(PlaylistID=playlist.ID)
                            if getattr(s, "rb_local_deleted", 0) == 0
                        ]
                    )
                except Exception:
                    track_count = 0
                is_smart = bool(getattr(playlist, "is_smart_playlist", False))
                is_folder = bool(getattr(playlist, "is_folder", False)) or (
                    getattr(playlist, "Attribute", 0) == 1
                )
                result.append(
                    Playlist(
                        id=str(playlist.ID),
                        name=playlist.Name or "",
                        track_count=track_count,
                        created_date=getattr(playlist, "created_at", "") or "",
                        modified_date=getattr(playlist, "updated_at", "") or "",
                        is_folder=is_folder,
                        is_smart_playlist=is_smart,
                        smart_criteria=(
                            str(playlist.SmartList)
                            if is_smart and getattr(playlist, "SmartList", None)
                            else None
                        ),
                        parent_id=(
                            str(playlist.ParentID)
                            if playlist.ParentID and playlist.ParentID != "root"
                            else None
                        ),
                    )
                )
            return result

        return await asyncio.to_thread(_inner)


    async def get_track_by_id(self, track_id: str) -> Optional[Track]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            try:
                content = self.db.get_content(ID=int(track_id))
                if content and getattr(content, "rb_local_deleted", 0) == 0:
                    return self._content_to_track(content)
                return None
            except (ValueError, Exception):
                return None
        return await asyncio.to_thread(_inner)

    async def get_playlist_tracks(self, playlist_id: str) -> List[Track]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            songs = [s for s in self.db.get_playlist_songs(PlaylistID=int(playlist_id)) if getattr(s, "rb_local_deleted", 0) == 0]
            lookup = {str(c.ID): c for c in self._get_active_content()}
            return [self._content_to_track(lookup[str(s.ContentID)]) for s in sorted(songs, key=lambda x: getattr(x, "TrackNo", 0)) if str(s.ContentID) in lookup]
        return await asyncio.to_thread(_inner)

    async def get_most_played_tracks(self, limit: int = 20) -> List[Track]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            return [self._content_to_track(c) for c in sorted(self._get_active_content(), key=lambda x: getattr(x, "DJPlayCount", 0) or 0, reverse=True)[:limit]]
        return await asyncio.to_thread(_inner)

    async def get_top_rated_tracks(self, limit: int = 20) -> List[Track]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            return [self._content_to_track(c) for c in sorted(self._get_active_content(), key=lambda x: (getattr(x, "Rating", 0) or 0, getattr(x, "DJPlayCount", 0) or 0), reverse=True)[:limit]]
        return await asyncio.to_thread(_inner)

    async def get_unplayed_tracks(self, limit: int = 50) -> List[Track]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            return [self._content_to_track(c) for c in self._get_active_content() if (getattr(c, "DJPlayCount", 0) or 0) == 0][:limit]
        return await asyncio.to_thread(_inner)

    async def search_tracks_by_filename(self, filename: str) -> List[Track]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            q = filename.lower()
            return [self._content_to_track(c) for c in self._get_active_content() if q in (getattr(c, "FolderPath", "") or "").lower()]
        return await asyncio.to_thread(_inner)

    async def analyze_library(self, group_by: str, aggregate_by: str, top_n: int) -> Dict[str, Any]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            field_map = {"genre": "GenreName", "key": "KeyName", "year": "ReleaseYear", "artist": "ArtistName", "rating": "Rating"}
            attr = field_map.get(group_by, "GenreName"); groups: Dict[str, Dict[str, int]] = {}
            for c in self._get_active_content():
                k = str(getattr(c, attr, "") or "Unknown")
                groups.setdefault(k, {"count": 0, "playCount": 0, "totalTime": 0})
                groups[k]["count"] += 1; groups[k]["playCount"] += getattr(c, "DJPlayCount", 0) or 0; groups[k]["totalTime"] += getattr(c, "Length", 0) or 0
            srt = sorted(groups.items(), key=lambda x: x[1][aggregate_by], reverse=True)
            return {"group_by": group_by, "aggregate_by": aggregate_by, "results": dict(srt[:top_n]), "total_groups": len(groups)}
        return await asyncio.to_thread(_inner)

    async def validate_track_ids(self, track_ids: List[str]) -> Dict[str, Any]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            existing = {str(c.ID) for c in self._get_active_content()}
            return {"valid": [t for t in track_ids if t in existing], "invalid": [t for t in track_ids if t not in existing], "total_checked": len(track_ids), "valid_count": len([t for t in track_ids if t in existing]), "invalid_count": len([t for t in track_ids if t not in existing])}
        return await asyncio.to_thread(_inner)

    async def get_library_stats(self) -> LibraryStats:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            a = self._get_active_content(); total = len(a)
            genres: Dict[str, int] = {}
            for c in a: genres[getattr(c, "GenreName", "") or "Unknown"] = genres.get(getattr(c, "GenreName", "") or "Unknown", 0) + 1
            return LibraryStats(total_tracks=total, total_playtime_seconds=sum(getattr(c, "Length", 0) or 0 for c in a), average_bpm=round(sum((getattr(c, "BPM", 0) or 0) / 100.0 for c in a) / total, 2) if total else 0, genre_distribution=dict(sorted(genres.items(), key=lambda x: x[1], reverse=True)[:10]), database_path=str(self.database_path), last_updated=datetime.now().isoformat())
        return await asyncio.to_thread(_inner)

    async def get_tracks_by_genre(self, genre: str) -> List[str]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            q = genre.lower()
            return [getattr(c, "FolderPath", "") for c in self._get_active_content() if q in (getattr(c, "GenreName", "") or "").lower() and getattr(c, "FolderPath", "")]
        return await asyncio.to_thread(_inner)

    async def get_history_sessions(self, include_folders: bool = False) -> List[HistorySession]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            lookup = {str(c.ID): c for c in self._get_active_content()}; out = []
            for h in self.db.get_history():
                if getattr(h, "rb_local_deleted", 0) != 0: continue
                is_folder = h.Attribute == 1
                if not include_folders and is_folder: continue
                count = 0; duration = None
                if not is_folder:
                    try:
                        songs = [s for s in self.db.get_history_songs(HistoryID=h.ID) if getattr(s, "rb_local_deleted", 0) == 0]
                        count = len(songs); secs = sum(getattr(lookup[str(s.ContentID)], "Length", 0) or 0 for s in songs if str(s.ContentID) in lookup)
                        duration = round(secs / 60) if secs else None
                    except Exception: count = 0
                out.append(HistorySession(id=str(h.ID), name=h.Name or "", parent_id=str(h.ParentID) if h.ParentID and h.ParentID != "root" else None, is_folder=is_folder, date_created=h.DateCreated, track_count=count, duration_minutes=duration))
            return out
        return await asyncio.to_thread(_inner)

    async def get_session_tracks(self, session_id: str) -> List[HistoryTrack]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            lookup = {str(c.ID): c for c in self._get_active_content()}; out = []
            for s in sorted([x for x in self.db.get_history_songs(HistoryID=int(session_id)) if getattr(x, "rb_local_deleted", 0) == 0], key=lambda x: x.TrackNo):
                if str(s.ContentID) in lookup:
                    t = self._content_to_track(lookup[str(s.ContentID)])
                    out.append(HistoryTrack(**{**t.__dict__}, track_number=s.TrackNo, history_id=session_id, play_order=s.TrackNo))
            return out
        return await asyncio.to_thread(_inner)

    async def get_history_stats(self) -> HistoryStats:
        if not self.db:
            raise RuntimeError("Database not connected")
        sessions = await self.get_history_sessions(include_folders=False)
        total_min = sum(s.duration_minutes for s in sessions if s.duration_minutes); by_month: Dict[str, int] = {}
        for s in sessions:
            if s.date_created:
                try: by_month[s.date_created[:7]] = by_month.get(s.date_created[:7], 0) + 1
                except Exception: pass
        return HistoryStats(total_sessions=len(sessions), total_tracks_played=sum(s.track_count for s in sessions), total_hours_played=round(total_min / 60, 1) if total_min else 0.0, sessions_by_month=by_month, avg_session_length=round(total_min / len(sessions), 1) if sessions else 0.0, favorite_genres=[], most_played_track=None)

    SUPPORTED_EXTENSIONS = {".mp3", ".m4a", ".flac", ".wav", ".aiff", ".aif"}

    async def import_track(self, path: str, metadata: Optional[Dict[str, Any]] = None, auto_tag: bool = True) -> Dict[str, Any]:
        """Import a single file. Full tag/creation logic: use pyrekordbox add_content - see flux-db.js for the browser flow."""
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            fp = Path(path).expanduser().resolve()
            if not fp.is_file(): return {"status": "error", "path": str(fp), "reason": "file not found"}
            if fp.suffix.lower() not in self.SUPPORTED_EXTENSIONS: return {"status": "error", "path": str(fp), "reason": f"unsupported extension {fp.suffix}"}
            merged: Dict[str, Any] = {}
            if metadata: merged.update({k: v for k, v in metadata.items() if v is not None})
            self._create_backup()
            try:
                content = self.db.add_content(str(fp), **({"Title": merged["title"]} if merged.get("title") else {}))
                self.db.commit(); self._invalidate_content_cache()
                return {"status": "success", "track_id": str(content.ID), "path": str(fp), "metadata": merged}
            except ValueError as e:
                return {"status": "skipped" if "already exists" in str(e).lower() else "error", "path": str(fp), "reason": str(e)}
        return await asyncio.to_thread(_inner)

    async def create_playlist(self, name: str, parent_id: Optional[str] = None, is_folder: bool = False) -> str:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            self._create_backup(); parent = int(parent_id) if parent_id and parent_id != "root" else None
            playlist = self.db.create_playlist_folder(name=name, parent=parent) if is_folder else self.db.create_playlist(name=name, parent=parent)
            self.db.commit(); self._invalidate_content_cache()
            return str(getattr(playlist, "ID", playlist))
        return await asyncio.to_thread(_inner)

    async def add_track_to_playlist(self, playlist_id: str, track_id: str) -> bool:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            self._create_backup(); self.db.add_to_playlist(int(playlist_id), int(track_id)); self.db.commit(); self._invalidate_content_cache(); return True
        return await asyncio.to_thread(_inner)

    async def add_tracks_to_playlist(self, playlist_id: str, track_ids: List[str]) -> Dict[str, Any]:
        results: Dict[str, list] = {"added": [], "failed": [], "skipped": []}
        for tid in track_ids:
            try: await self.add_track_to_playlist(playlist_id, tid); results["added"].append(tid)
            except Exception as e: results["failed"].append({"track_id": tid, "reason": str(e)})
        return results

    async def remove_track_from_playlist(self, playlist_id: str, track_id: str) -> bool:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            self._create_backup(); self.db.remove_from_playlist(int(playlist_id), int(track_id)); self.db.commit(); self._invalidate_content_cache(); return True
        return await asyncio.to_thread(_inner)

    async def delete_playlist(self, playlist_id: str) -> bool:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            self._create_backup(); self.db.delete_playlist(int(playlist_id)); self.db.commit(); self._invalidate_content_cache(); return True
        return await asyncio.to_thread(_inner)

    async def find_broken_tracks(self) -> Dict[str, Any]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            empty, streams, missing = [], [], []
            for c in self._get_active_content():
                fp = getattr(c, "FolderPath", "") or ""
                if not fp.strip(): empty.append({"id": str(c.ID), "title": getattr(c, "Title", "") or ""})
                elif fp.startswith("apple-music:"): streams.append({"id": str(c.ID), "title": getattr(c, "Title", "") or "", "path": fp})
                elif not os.path.exists(fp): missing.append({"id": str(c.ID), "title": getattr(c, "Title", "") or "", "path": fp})
            return {"empty_path": empty, "apple_music_streams": streams, "missing_files": missing, "orphaned_playlist_refs": [], "summary": {"empty_path_count": len(empty), "apple_music_count": len(streams), "missing_file_count": len(missing), "orphaned_ref_count": 0}}
        return await asyncio.to_thread(_inner)

    async def remove_tracks_by_ids(self, track_ids: List[str]) -> Dict[str, Any]:
        if not self.db:
            raise RuntimeError("Database not connected")
        def _inner():
            self._create_backup(); removed, not_found = [], []
            for tid in track_ids:
                try: content = self.db.get_content(ID=int(tid))
                except Exception: not_found.append(tid); continue
                if not content: not_found.append(tid); continue
                content.rb_local_deleted = 1; removed.append({"id": tid, "title": getattr(content, "Title", "") or ""})
            self.db.commit(); self._invalidate_content_cache()
            return {"removed": removed, "not_found": not_found}
        return await asyncio.to_thread(_inner)
