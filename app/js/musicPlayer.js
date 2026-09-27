import { getAll, put, remove, generateId } from './db.js';

const els = {};
const state = {
  playlist: [],
  currentId: null,
  shuffleOn: false,
  loopState: 0, // 0: ループなし, 1: 全体ループ, 2: 1曲ループ
  isPlaying: false,
  volume: 100,
};

let player = null;
let apiLoadPromise = null;

const VIDEO_ID_REGEX = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

function extractVideoId(url) {
  const match = url.match(VIDEO_ID_REGEX);
  return match ? match[1] : null;
}

function orderedTracks() {
  return [...state.playlist].sort((a, b) => a.order - b.order);
}

const VOLUME_STORAGE_KEY = 'pomodoro-music-volume';

function loadVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw === null) return 100;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 100;
  } catch (e) {
    return 100;
  }
}

function saveVolume(value) {
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(value));
  } catch (e) {
    // localStorageが使えない環境では保存をスキップする
  }
}

async function fetchVideoMeta(videoId) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { title: data.title, thumbnail: data.thumbnail_url };
  } catch (e) {
    return null;
  }
}

function loadYouTubeApi() {
  if (apiLoadPromise) return apiLoadPromise;
  apiLoadPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousCallback === 'function') previousCallback();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return apiLoadPromise;
}

async function ensurePlayer() {
  if (player) return player;
  await loadYouTubeApi();
  return new Promise((resolve) => {
    els.playerWrap.hidden = false;
    player = new window.YT.Player(els.playerMount, {
      height: '180',
      width: '320',
      playerVars: { autoplay: 0, playsinline: 1, rel: 0 },
      events: {
        onReady: () => {
          player.setVolume(state.volume);
          resolve(player);
        },
        onStateChange: onPlayerStateChange,
        onError: onPlayerError,
      },
    });
  });
}

// documentPictureInPicture(小窓)は元のドキュメントとは別の最上位ブラウジング
// コンテキストになるため、その中で新規に作られたYouTube埋め込みiframeは
// 参照元(Referer/Origin)情報を検証できずエラー153で弾かれてしまう。
// そのためプレーヤー本体(iframe)は小窓には移動させず常にメインウィンドウ側に
// 留めている。ただしiframeはDOM上の位置を動かすだけで(同一ドキュメント内でも)
// 再読み込みされ再生が途切れるため、切り替えのたびに表示側も停止状態に揃える。
export function detachPlayerForPip() {
  if (!els.playerWrap) return;
  document.body.appendChild(els.playerWrap);
  els.playerWrap.classList.add('is-detached');
  resetPlaybackUiAfterInterruption();
}

export function reattachPlayerFromPip() {
  if (!els.playerWrap || !els.playerWrapParent) return;
  if (els.playerWrapNextSibling && els.playerWrapNextSibling.parentNode === els.playerWrapParent) {
    els.playerWrapParent.insertBefore(els.playerWrap, els.playerWrapNextSibling);
  } else {
    els.playerWrapParent.appendChild(els.playerWrap);
  }
  els.playerWrap.classList.remove('is-detached');
  resetPlaybackUiAfterInterruption();
}

function resetPlaybackUiAfterInterruption() {
  state.isPlaying = false;
  clearPlayerError();
  renderControls();
}

function onPlayerStateChange(event) {
  const YT = window.YT;
  if (!YT) return;
  if (event.data === YT.PlayerState.ENDED) {
    handleTrackEnded();
  } else if (event.data === YT.PlayerState.PLAYING) {
    state.isPlaying = true;
    clearPlayerError();
    maybeUpdateCurrentTitle();
    renderControls();
  } else if (event.data === YT.PlayerState.PAUSED) {
    state.isPlaying = false;
    renderControls();
  } else if (event.data === YT.PlayerState.CUED) {
    maybeUpdateCurrentTitle();
  }
}

const PLAYER_ERROR_MESSAGES = {
  2: '動画IDが正しくありません',
  5: 'この動画は再生できません',
  100: '動画が見つからないか削除されています',
  101: 'この動画は投稿者により埋め込み再生が禁止されています',
  150: 'この動画は投稿者により埋め込み再生が禁止されています',
};

function onPlayerError(event) {
  showPlayerError(PLAYER_ERROR_MESSAGES[event.data] || '動画の再生中にエラーが発生しました');
  state.isPlaying = false;
  renderControls();
}

function showPlayerError(message) {
  els.playerError.textContent = message;
  els.playerError.hidden = false;
}

function clearPlayerError() {
  els.playerError.hidden = true;
}

async function maybeUpdateCurrentTitle() {
  if (!player || !state.currentId) return;
  const data = typeof player.getVideoData === 'function' ? player.getVideoData() : null;
  if (data && data.title) {
    const track = state.playlist.find((t) => t.id === state.currentId);
    if (track && track.title !== data.title) {
      track.title = data.title;
      await put('playlist', track);
      renderPlaylist();
      renderNowPlaying();
    }
  }
}

function pickNextId() {
  const tracks = orderedTracks();
  if (tracks.length === 0) return null;
  if (state.shuffleOn) {
    const candidates = tracks.filter((t) => t.id !== state.currentId);
    const pool = candidates.length > 0 ? candidates : tracks;
    return pool[Math.floor(Math.random() * pool.length)].id;
  }
  const idx = tracks.findIndex((t) => t.id === state.currentId);
  if (idx === -1) return tracks[0].id;
  if (idx + 1 < tracks.length) return tracks[idx + 1].id;
  return state.loopState === 1 ? tracks[0].id : null;
}

function pickPrevId() {
  const tracks = orderedTracks();
  if (tracks.length === 0) return null;
  if (state.shuffleOn) {
    const candidates = tracks.filter((t) => t.id !== state.currentId);
    const pool = candidates.length > 0 ? candidates : tracks;
    return pool[Math.floor(Math.random() * pool.length)].id;
  }
  const idx = tracks.findIndex((t) => t.id === state.currentId);
  if (idx <= 0) return tracks[tracks.length - 1].id;
  return tracks[idx - 1].id;
}

async function playTrackById(id) {
  const track = state.playlist.find((t) => t.id === id);
  if (!track) return;
  state.currentId = id;
  clearPlayerError();
  await ensurePlayer();
  player.loadVideoById(track.videoId);
  state.isPlaying = true;
  renderNowPlaying();
  renderPlaylist();
  renderControls();
}

async function handleTrackEnded() {
  if (state.loopState === 2) {
    player.seekTo(0);
    player.playVideo();
    return;
  }
  const nextId = pickNextId();
  if (nextId) {
    await playTrackById(nextId);
  } else {
    state.isPlaying = false;
    renderControls();
  }
}

async function togglePlayPause() {
  if (!state.currentId) {
    const tracks = orderedTracks();
    if (tracks.length === 0) return;
    await playTrackById(tracks[0].id);
    return;
  }
  await ensurePlayer();
  if (state.isPlaying) {
    player.pauseVideo();
    state.isPlaying = false;
  } else {
    player.playVideo();
    state.isPlaying = true;
  }
  renderControls();
}

async function playNext() {
  const nextId = pickNextId();
  if (nextId) await playTrackById(nextId);
}

async function playPrev() {
  const prevId = pickPrevId();
  if (prevId) await playTrackById(prevId);
}

function toggleShuffle() {
  state.shuffleOn = !state.shuffleOn;
  renderControls();
}

function cycleLoop() {
  state.loopState = (state.loopState + 1) % 3;
  renderControls();
}

async function addTrack(rawUrl) {
  const url = rawUrl.trim();
  if (!url) return;
  const videoId = extractVideoId(url);
  if (!videoId) {
    els.urlError.textContent = '有効なYouTubeのURLを入力してください';
    els.urlError.hidden = false;
    return;
  }
  if (state.playlist.some((t) => t.videoId === videoId)) {
    els.urlError.textContent = 'すでにプレイリストに追加されています';
    els.urlError.hidden = false;
    return;
  }
  els.urlError.hidden = true;
  els.urlInput.value = '';
  els.addBtn.disabled = true;
  const meta = await fetchVideoMeta(videoId);
  const maxOrder = Math.max(-1, ...state.playlist.map((t) => t.order));
  const track = {
    id: generateId(),
    videoId,
    url,
    title: meta ? meta.title : url,
    thumbnail: meta ? meta.thumbnail : null,
    order: maxOrder + 1,
  };
  state.playlist.push(track);
  await put('playlist', track);
  renderPlaylist();
  els.addBtn.disabled = false;
}

async function deleteTrack(id) {
  state.playlist = state.playlist.filter((t) => t.id !== id);
  await remove('playlist', id);
  if (state.currentId === id) {
    state.currentId = null;
    if (player) player.stopVideo();
    state.isPlaying = false;
  }
  renderPlaylist();
  renderNowPlaying();
  renderControls();
}

function renderPlaylist() {
  els.playlistEl.innerHTML = '';
  orderedTracks().forEach((track) => {
    const li = document.createElement('li');
    li.className = 'playlist-item' + (track.id === state.currentId ? ' is-playing' : '');
    li.dataset.id = track.id;

    const thumb = document.createElement('img');
    thumb.className = 'playlist-item-thumb';
    thumb.src = track.thumbnail || `https://i.ytimg.com/vi/${track.videoId}/default.jpg`;
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.addEventListener('click', () => playTrackById(track.id));

    const title = document.createElement('span');
    title.className = 'playlist-item-title';
    title.textContent = track.title;
    title.title = track.title;
    title.addEventListener('click', () => playTrackById(track.id));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'playlist-item-delete';
    del.title = '削除';
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTrack(track.id);
    });

    li.append(thumb, title, del);
    els.playlistEl.appendChild(li);
  });
}

function renderNowPlaying() {
  const track = state.playlist.find((t) => t.id === state.currentId);
  els.nowPlaying.textContent = track ? track.title : '再生中の曲はありません';
}

const LOOP_LABELS = ['ループなし', '全体ループ', '1曲ループ'];
const LOOP_ICONS = ['🔁', '🔁', '🔂'];

function renderControls() {
  els.playBtn.textContent = state.isPlaying ? '⏸' : '▶';
  els.playBtn.title = state.isPlaying ? '一時停止' : '再生';
  els.shuffleBtn.classList.toggle('is-active', state.shuffleOn);
  els.loopBtn.classList.toggle('is-active', state.loopState !== 0);
  els.loopBtn.textContent = LOOP_ICONS[state.loopState];
  els.loopBtn.title = LOOP_LABELS[state.loopState];
}

export async function initMusicPlayer() {
  els.urlInput = document.getElementById('music-url-input');
  els.addBtn = document.getElementById('music-add');
  els.urlError = document.getElementById('music-url-error');
  els.playerWrap = document.getElementById('youtube-player-wrap');
  els.playerWrapParent = els.playerWrap.parentNode;
  els.playerWrapNextSibling = els.playerWrap.nextSibling;
  els.playerMount = document.getElementById('youtube-player-mount');
  els.playerError = document.getElementById('music-player-error');
  els.nowPlaying = document.getElementById('music-now-playing');
  els.shuffleBtn = document.getElementById('music-shuffle');
  els.prevBtn = document.getElementById('music-prev');
  els.playBtn = document.getElementById('music-play');
  els.nextBtn = document.getElementById('music-next');
  els.loopBtn = document.getElementById('music-loop');
  els.volumeSlider = document.getElementById('music-volume');
  els.playlistEl = document.getElementById('playlist');

  state.playlist = await getAll('playlist');
  state.volume = loadVolume();
  els.volumeSlider.value = String(state.volume);

  renderPlaylist();
  renderNowPlaying();
  renderControls();

  els.addBtn.addEventListener('click', () => addTrack(els.urlInput.value));
  els.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTrack(els.urlInput.value);
  });
  els.shuffleBtn.addEventListener('click', toggleShuffle);
  els.loopBtn.addEventListener('click', cycleLoop);
  els.playBtn.addEventListener('click', togglePlayPause);
  els.nextBtn.addEventListener('click', playNext);
  els.prevBtn.addEventListener('click', playPrev);
  els.volumeSlider.addEventListener('input', () => {
    const value = Number(els.volumeSlider.value);
    state.volume = value;
    saveVolume(value);
    if (player && typeof player.setVolume === 'function') player.setVolume(value);
  });
}
