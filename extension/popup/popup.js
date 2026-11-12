(function() {
  'use strict';

  function showTab(tabId) {
    document.querySelectorAll('.tab').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(function(content) {
      content.classList.toggle('active', content.id === 'tab-' + tabId);
    });
  }

  document.querySelectorAll('.tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      showTab(btn.dataset.tab);
    });
  });

  function loadUser(cb) {
    chrome.storage.local.get('hm.user', function(result) {
      cb(result['hm.user'] || { artists: [], songs: [], keywords: [], neverSkip: [] });
    });
  }

  function saveUser(user) {
    chrome.storage.local.set({ 'hm.user': user });
  }

  function loadSettings(cb) {
    chrome.storage.local.get('hm.settings', function(result) {
      var raw = result['hm.settings'] || {};
      cb(HM.settings.sanitize(raw));
    });
  }

  function saveSettings(settings) {
    chrome.storage.local.set({ 'hm.settings': HM.settings.sanitize(settings) });
  }

  function loadLists(cb) {
    chrome.storage.local.get('hm.filterLists', function(result) {
      var lists = result['hm.filterLists'] || [];
      if (!HM.lists.has(lists, HM.lists.SOUL_OVER_AI.id)) {
        lists = lists.concat([HM.lists.SOUL_OVER_AI]);
      }
      cb(lists);
    });
  }

  function saveLists(lists) {
    chrome.storage.local.set({ 'hm.filterLists': lists });
  }

  function renderFilterLists() {
    loadLists(function(lists) {
      var el = document.getElementById('filter-lists');
      el.innerHTML = '';
      lists.forEach(function(list) {
        var li = document.createElement('li');
        var label = document.createElement('span');
        label.textContent = list.name;
        if (list.builtIn) {
          label.textContent += ' (built-in)';
        }
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = list.enabled;
        checkbox.addEventListener('change', function() {
          list.enabled = checkbox.checked;
          saveLists(lists);
        });
        li.appendChild(checkbox);
        li.appendChild(label);
        if (!list.builtIn) {
          var removeBtn = document.createElement('button');
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', function() {
            lists = HM.popup.removeFilterList(lists, list.id);
            saveLists(lists);
            renderFilterLists();
          });
          li.appendChild(removeBtn);
        }
        el.appendChild(li);
      });
    });
  }

  renderFilterLists();

  document.getElementById('add-list-btn').addEventListener('click', function() {
    var url = document.getElementById('list-url').value;
    var name = document.getElementById('list-name').value;
    loadLists(function(lists) {
      try {
        lists = HM.popup.addFilterList(lists, url, name);
        saveLists(lists);
        document.getElementById('list-url').value = '';
        document.getElementById('list-name').value = '';
        renderFilterLists();
      } catch (e) {
        alert(e.message);
      }
    });
  });

  function renderUserLists() {
    loadUser(function(user) {
      var renderList = function(containerId, kind, display) {
        var el = document.getElementById(containerId);
        el.innerHTML = '';
        user[kind].forEach(function(entry, idx) {
          var li = document.createElement('li');
          li.textContent = typeof entry === 'string' ? entry : entry.title + (entry.artist ? ' - ' + entry.artist : '');
          var removeBtn = document.createElement('button');
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', function() {
            user = HM.popup.removeEntry(user, kind, idx);
            saveUser(user);
            renderUserLists();
          });
          li.appendChild(removeBtn);
          el.appendChild(li);
        });
      };
      renderList('artists', 'artists', 'artist');
      renderList('songs', 'songs', 'song');
      renderList('keywords', 'keywords', 'keyword');
      renderList('never-skip', 'neverSkip', 'never skip');
    });
  }

  renderUserLists();

  document.querySelectorAll('.add-entry-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var kind = btn.dataset.kind;
      var inputId;
      if (kind === 'artists') {
        inputId = 'artist-input';
      } else if (kind === 'keywords') {
        inputId = 'keyword-input';
      } else {
        inputId = 'never-skip-input';
      }
      var input = document.getElementById(inputId);
      loadUser(function(user) {
        user = HM.popup.addEntry(user, kind, input.value);
        saveUser(user);
        input.value = '';
        renderUserLists();
      });
    });
  });

  document.getElementById('add-song-btn').addEventListener('click', function() {
    var title = document.getElementById('song-title').value;
    var artist = document.getElementById('song-artist').value;
    loadUser(function(user) {
      user = HM.popup.addSong(user, title, artist || null);
      saveUser(user);
      document.getElementById('song-title').value = '';
      document.getElementById('song-artist').value = '';
      renderUserLists();
    });
  });

  function renderSettings() {
    loadSettings(function(settings) {
      document.getElementById('lookahead').value = settings.lookahead;
      document.getElementById('auto-skip').checked = settings.autoSkip;
      document.getElementById('auto-dislike').checked = settings.autoDislike;
      document.getElementById('hide-items').checked = settings.hideItems;
      document.getElementById('player-buttons').checked = settings.playerButtons;
      document.getElementById('paused').checked = settings.paused;
      document.getElementById('refresh-frequency').value = settings.refreshFrequency;
    });
  }

  renderSettings();

  document.querySelectorAll('#tab-behaviour .setting input, #tab-behaviour .setting select').forEach(function(el) {
    el.addEventListener('change', function() {
      loadSettings(function(settings) {
        if (el.id === 'lookahead') {
          settings.lookahead = parseInt(el.value) || 0;
        } else if (el.id === 'refresh-frequency') {
          settings.refreshFrequency = el.value;
        } else {
          settings[el.id] = el.checked;
        }
        saveSettings(settings);
      });
    });
  });

  document.getElementById('export-btn').addEventListener('click', function() {
    chrome.storage.local.get(['hm.user', 'hm.settings', 'hm.filterLists'], function(result) {
      var data = {
        version: 1,
        user: result['hm.user'],
        settings: result['hm.settings'],
        filterLists: result['hm.filterLists']
      };
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'human-music-backup.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  document.getElementById('import-btn').addEventListener('click', function() {
    var file = document.getElementById('import-file').files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var data = JSON.parse(e.target.result);
        if (data.user) {
          chrome.storage.local.set({ 'hm.user': data.user });
        }
        if (data.settings) {
          chrome.storage.local.set({ 'hm.settings': HM.settings.sanitize(data.settings) });
        }
        if (data.filterLists) {
          chrome.storage.local.set({ 'hm.filterLists': data.filterLists });
        }
        renderSettings();
        renderUserLists();
        renderFilterLists();
        alert('Imported successfully.');
      } catch (err) {
        alert('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  });

  function renderLog() {
    chrome.storage.local.get('hm.log', function(result) {
      var log = result['hm.log'] || [];
      var el = document.getElementById('log-entries');
      el.innerHTML = '';
      log.slice(0, 50).forEach(function(entry) {
        var li = document.createElement('li');
        var desc = document.createElement('div');
        desc.className = 'log-desc';
        desc.textContent = entry.description;
        li.appendChild(desc);
        var meta = document.createElement('div');
        meta.className = 'log-meta';
        meta.textContent = entry.time + (entry.source ? ' from ' + entry.source : '');
        li.appendChild(meta);
        if (entry.type === 'skip') {
          var undoBtn = document.createElement('button');
          undoBtn.textContent = 'Undo';
          undoBtn.addEventListener('click', function() {
            chrome.runtime.sendMessage({ type: 'undo-skip', entry: entry });
            entry.restored = true;
            entry.restoredTime = Date.now();
            chrome.storage.local.set({ 'hm.log': log });
          });
          li.appendChild(undoBtn);
        }
        el.appendChild(li);
      });
    });
  }

  renderLog();

  document.getElementById('clear-log').addEventListener('click', function() {
    chrome.storage.local.set({ 'hm.log': [] });
    renderLog();
  });

  document.getElementById('export-log').addEventListener('click', function() {
    chrome.storage.local.get('hm.log', function(result) {
      var log = result['hm.log'] || [];
      var text = log.map(function(entry) {
        return entry.time + ' [' + entry.type + '] ' + entry.description +
               (entry.source ? ' (source: ' + entry.source + ')' : '');
      }).join('\n');
      var blob = new Blob([text], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'human-music-log.txt';
      a.click();
      URL.revokeObjectURL(url);
    });
  });
})();