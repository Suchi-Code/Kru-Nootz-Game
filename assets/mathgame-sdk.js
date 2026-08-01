/* ============================================================
   MathGame SDK — shared helper for ครูนุช's math games
   Include this AFTER the Supabase JS CDN script in every game:

   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
   <script src="assets/mathgame-sdk.js"></script>   (adjust the path
   to wherever this file sits relative to the game file)

   Configure your Supabase project ONCE below — every game file
   and index.html will then share the same connection.
   ============================================================ */
(function (global) {
  var SUPABASE_URL = 'https://dighrbbikdloxszbepee.supabase.co';         // e.g. https://xxxxxxxx.supabase.co
  var SUPABASE_ANON_KEY = 'sb_publishable_A3MPkcB74wHi7deZ5xEOlg_V9xXH_gK';
  var HEARTS_DEFAULT = 3;

  var NAME_KEY = 'mathClassPlayerName';
  var DEVICE_KEY = 'mathClassDeviceId';

  var client = null;
  function getClient() {
    if (client) return client;
    var configured = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
    if (configured && global.supabase && global.supabase.createClient) {
      client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return client;
  }

  function getDeviceId() {
    try {
      var id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) { return ''; }
  }

  // Reads the player's name/device — from the URL if the page was opened
  // from the homepage (?name=...&device=...), otherwise falls back to
  // whatever is saved in this browser already.
  function getPlayer() {
    var params = new URLSearchParams(global.location.search);
    var urlName = params.get('name');
    var urlDevice = params.get('device');

    var device = urlDevice || getDeviceId();
    var name = urlName || '';
    try {
      if (!name) name = localStorage.getItem(NAME_KEY) || '';
      if (urlName) localStorage.setItem(NAME_KEY, urlName);
      if (urlDevice) localStorage.setItem(DEVICE_KEY, urlDevice);
    } catch (e) {}

    return { name: name, device: device };
  }

  // Makes sure a row exists in `players` for this device (in case the
  // game was opened without ever visiting the homepage first).
  async function ensurePlayerRow(deviceId, name) {
    var supa = getClient();
    if (!supa || !deviceId) return null;
    try {
      var existing = await supa.from('players').select('hearts_remaining, name').eq('device_id', deviceId).maybeSingle();
      if (existing.data) return existing.data;
      var insertPayload = { device_id: deviceId, name: name || 'นักเรียน', hearts_remaining: HEARTS_DEFAULT };
      var created = await supa.from('players').insert(insertPayload).select('hearts_remaining, name').maybeSingle();
      return created.data;
    } catch (e) {
      console.warn('ensurePlayerRow failed', e);
      return null;
    }
  }

  async function getHearts() {
    var player = getPlayer();
    var row = await ensurePlayerRow(player.device, player.name);
    return row ? row.hearts_remaining : null;
  }

  // Call this when the player finishes a game.
  // Returns { saved, isNewBest, hearts, reason }
  //   reason: 'no-config' | 'no-player' | 'not-better' | 'no-hearts' | 'error' | ''
  async function submitScore(gameId, score, total, timeSeconds) {
    var result = { saved: false, isNewBest: false, hearts: null, reason: '' };
    var supa = getClient();
    var player = getPlayer();

    if (!supa) { result.reason = 'no-config'; return result; }
    if (!player.device) { result.reason = 'no-player'; return result; }

    try {
      await ensurePlayerRow(player.device, player.name);

      var existing = await supa.from('game_results')
        .select('id, score, time_seconds')
        .eq('device_id', player.device)
        .eq('game_id', gameId)
        .maybeSingle();

      var prev = existing.data;
      var isFirstPlay = !prev;
      var isBetter = isFirstPlay || score > prev.score || (score === prev.score && timeSeconds < prev.time_seconds);

      if (!isFirstPlay && !isBetter) {
        result.reason = 'not-better';
        result.hearts = await getHearts();
        return result;
      }

      if (!isFirstPlay) {
        // replaying an already-completed game to try to improve -> costs 1 heart
        var heartsNow = await getHearts();
        if (heartsNow !== null && heartsNow <= 0) {
          result.reason = 'no-hearts';
          result.hearts = 0;
          return result;
        }
        if (heartsNow !== null) {
          await supa.from('players').update({ hearts_remaining: heartsNow - 1 }).eq('device_id', player.device);
          result.hearts = heartsNow - 1;
        }
      } else {
        result.hearts = await getHearts();
      }

      await supa.from('game_results').upsert({
        device_id: player.device,
        game_id: gameId,
        score: score,
        total_questions: total,
        time_seconds: timeSeconds,
        updated_at: new Date().toISOString()
      }, { onConflict: 'device_id,game_id' });

      result.saved = true;
      result.isNewBest = true;
      return result;
    } catch (e) {
      console.warn('submitScore failed', e);
      result.reason = 'error';
      return result;
    }
  }

  global.MathGameSDK = {
    getPlayer: getPlayer,
    getHearts: getHearts,
    submitScore: submitScore,
    getClient: getClient,
    isConfigured: function () { return !!getClient(); }
  };
})(window);
