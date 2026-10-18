"""Models for the Rekordbox database layer (rekordbox/models.py)."""
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any


@dataclass
class Track:
    id: str
    title: str = ""
    artist: str = ""
    album: str = ""
    genre: str = ""
    bpm: float = 0.0
    key: str = ""
    rating: int = 0
    play_count: int = 0
    length: int = 0
    file_path: str = ""
    date_added: str = ""
    date_modified: str = ""
    bitrate: int = 0
    sample_rate: int = 0
    comments: str = ""


@dataclass
class Playlist:
    id: str
    name: str = ""
    track_count: int = 0
    created_date: str = ""
    modified_date: str = ""
    is_folder: bool = False
    is_smart_playlist: bool = False
    smart_criteria: Optional[str] = None
    parent_id: Optional[str] = None


@dataclass
class SearchOptions:
    query: str = ""
    artist: str = ""
    title: str = ""
    genre: str = ""
    key: str = ""
    bpm_min: Optional[float] = None
    bpm_max: Optional[float] = None
    rating_min: Optional[int] = None
    limit: int = 100


@dataclass
class HistorySession:
    id: str
    name: str = ""
    parent_id: Optional[str] = None
    is_folder: bool = False
    date_created: str = ""
    track_count: int = 0
    duration_minutes: Optional[int] = None


@dataclass
class HistoryTrack(Track):
    track_number: int = 0
    history_id: str = ""
    play_order: int = 0


@dataclass
class HistoryStats:
    total_sessions: int = 0
    total_tracks_played: int = 0
    total_hours_played: float = 0.0
    sessions_by_month: Dict[str, int] = field(default_factory=dict)
    avg_session_length: float = 0.0
    favorite_genres: List[Any] = field(default_factory=list)
    most_played_track: Optional[Any] = None


@dataclass
class LibraryStats:
    total_tracks: int = 0
    total_playtime_seconds: int = 0
    average_bpm: float = 0.0
    genre_distribution: Dict[str, int] = field(default_factory=dict)
    database_path: str = ""
    last_updated: str = ""
